// API mínima do portal para GitHub Pages + Supabase.
//
// O frontend é estático, então as operações que exigem servidor rodam aqui.
// A função valida o JWT do Supabase, usa o cliente com RLS para as consultas
// normais e reserva service_role para criar/alterar usuários do Auth.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const siteUrl = Deno.env.get("BLUECAT_SITE_URL") ?? "";
const siteOrigin = (() => {
  try {
    return siteUrl ? new URL(siteUrl).origin : "";
  } catch {
    return "";
  }
})();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function assertRuntimeConfig() {
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new HttpError(500, "A função não está configurada corretamente.");
  }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowed =
    !siteOrigin || origin === siteOrigin || origin === "http://localhost:3000";
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : siteOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown, field: string, min = 1, max = 5000) {
  const result = String(value ?? "").trim();
  if (result.length < min || result.length > max) {
    fail(400, `${field} está inválido.`);
  }
  return result;
}

function optionalText(value: unknown, max = 5000) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function email(value: unknown) {
  const result = text(value, "E-mail", 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    fail(400, "Informe um e-mail válido.");
  return result;
}

function uuid(value: unknown, field = "Identificador") {
  const result = text(value, field, 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  ) {
    fail(400, `${field} está inválido.`);
  }
  return result;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
}

function validVideoUrl(value: unknown) {
  const result = optionalText(value, 500);
  if (!result) return null;
  try {
    const parsed = new URL(result);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "youtu.be", "m.youtube.com"].includes(host))
      fail(400, "O vídeo deve ser um link do YouTube.");
    return result;
  } catch {
    fail(400, "O link do vídeo está inválido.");
  }
}

function temporaryPassword() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function publicClient(token?: string) {
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
  });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function profileFor(client: ReturnType<typeof publicClient>, id: string) {
  const { data, error } = await client
    .from("User")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) fail(500, "Não foi possível carregar o perfil.");
  if (!data || !data.active)
    fail(403, "Usuário inativo ou sem perfil configurado.");
  return data;
}

async function contextOf(request: Request) {
  const token = bearer(request);
  if (!token) fail(401, "Sessão necessária.");
  const auth = publicClient();
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) fail(401, "Sessão inválida ou expirada.");
  const client = publicClient(token);
  const profile = await profileFor(client, data.user.id);
  return { token, authUser: data.user, client, profile };
}

function requireAdmin(context: Awaited<ReturnType<typeof contextOf>>) {
  if (context.profile.role !== "PLATFORM_ADMIN")
    fail(403, "Acesso restrito ao administrador da plataforma.");
  return context;
}

async function companyFor(
  client: ReturnType<typeof publicClient>,
  companyId: string | null,
) {
  if (!companyId) return null;
  const { data } = await client
    .from("Company")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  return data ?? null;
}

function outputProfile(
  profile: Record<string, unknown>,
  company: Record<string, unknown> | null,
) {
  return {
    id: profile.id,
    companyId: profile.companyId,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    mustChangePassword: profile.mustChangePassword,
    active: profile.active,
    passwordChangedAt: profile.passwordChangedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    company,
  };
}

async function login(request: Request) {
  const input = await bodyOf(request);
  const client = publicClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email(input.email),
    password: text(input.password, "Senha", 8, 200),
  });
  if (error || !data.user || !data.session)
    fail(401, "E-mail ou senha inválidos.");
  const admin = adminClient();
  const { data: profile, error: profileError } = await admin
    .from("User")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile || !profile.active)
    fail(403, "Usuário sem acesso ativo ao portal.");
  return {
    user: outputProfile(profile, await companyFor(admin, profile.companyId)),
    mustChangePassword: profile.mustChangePassword,
    session: data.session,
  };
}

async function currentUser(request: Request) {
  const context = await contextOf(request);
  return outputProfile(
    context.profile,
    await companyFor(context.client, context.profile.companyId),
  );
}

async function changePassword(request: Request) {
  const context = await contextOf(request);
  const input = await bodyOf(request);
  const currentPassword = text(input.currentPassword, "Senha atual", 8, 200);
  const newPassword = text(input.newPassword, "Nova senha", 8, 200);
  if (currentPassword === newPassword)
    fail(400, "A nova senha deve ser diferente da atual.");

  // Revalida a senha atual pelo Auth antes de permitir a troca.
  const check = await publicClient().auth.signInWithPassword({
    email: String(context.profile.email),
    password: currentPassword,
  });
  if (check.error) fail(401, "A senha atual é inválida.");

  const admin = adminClient();
  const { error } = await admin.auth.admin.updateUserById(
    String(context.authUser.id),
    { password: newPassword },
  );
  if (error) fail(400, "Não foi possível atualizar a senha.");
  const { data: updated, error: updateError } = await admin
    .from("User")
    .update({
      mustChangePassword: false,
      passwordChangedAt: new Date().toISOString(),
    })
    .eq("id", context.authUser.id)
    .select("*")
    .single();
  if (updateError || !updated)
    fail(500, "Senha atualizada, mas o perfil não pôde ser sincronizado.");
  return outputProfile(updated, await companyFor(admin, updated.companyId));
}

async function categories(client: ReturnType<typeof publicClient>) {
  const [categoryResult, articleResult] = await Promise.all([
    client
      .from("Category")
      .select("*")
      .order("sortOrder", { ascending: true })
      .order("name", { ascending: true }),
    client.from("Article").select("id,categoryId"),
  ]);
  if (categoryResult.error || articleResult.error)
    fail(500, "Não foi possível carregar as categorias.");
  const byId = new Map(
    (categoryResult.data ?? []).map((item) => [item.id, item]),
  );
  const count = new Map<string, number>();
  for (const article of articleResult.data ?? [])
    count.set(article.categoryId, (count.get(article.categoryId) ?? 0) + 1);
  return (categoryResult.data ?? []).map((item) => ({
    ...item,
    parent: item.parentId ? (byId.get(item.parentId) ?? null) : null,
    _count: { articles: count.get(item.id) ?? 0 },
  }));
}

function articleOutput(
  article: Record<string, unknown>,
  category: Record<string, unknown> | null,
  author: Record<string, unknown> | null,
) {
  return {
    ...article,
    category,
    author: author
      ? { id: author.id, name: author.name, email: author.email }
      : { name: "BlueCat Systems" },
  };
}

async function articles(client: ReturnType<typeof publicClient>, url: URL) {
  let query = client
    .from("Article")
    .select("*")
    .order("updatedAt", { ascending: false });
  const status = url.searchParams.get("status");
  const categoryId = url.searchParams.get("categoryId");
  if (status) query = query.eq("status", status);
  if (categoryId) query = query.eq("categoryId", categoryId);
  const [articleResult, categoryResult, userResult] = await Promise.all([
    query,
    client.from("Category").select("id,name,slug,parentId"),
    client.from("User").select("id,name,email"),
  ]);
  if (articleResult.error || categoryResult.error)
    fail(500, "Não foi possível carregar os artigos.");
  const categoriesById = new Map(
    (categoryResult.data ?? []).map((item) => [item.id, item]),
  );
  const usersById = new Map(
    (userResult.data ?? []).map((item) => [item.id, item]),
  );
  const search = (url.searchParams.get("search") ?? "").toLowerCase();
  return (articleResult.data ?? [])
    .filter(
      (item) =>
        !search ||
        [item.title, item.summary, item.content]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search)),
    )
    .map((item) =>
      articleOutput(
        item,
        categoriesById.get(item.categoryId) ?? null,
        usersById.get(item.authorId) ?? null,
      ),
    );
}

async function articleById(
  client: ReturnType<typeof publicClient>,
  id: string,
) {
  const rows = await articles(
    client,
    new URL(`https://portal.local/?id=${id}`),
  );
  const article = rows.find((item) => item.id === id);
  if (!article) fail(404, "Artigo não encontrado.");
  return article;
}

async function createArticle(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
) {
  const input = await bodyOf(request);
  const title = text(input.title, "Título", 3, 180);
  const content = text(input.content, "Conteúdo", 1, 100000);
  const status = ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(
    String(input.status),
  )
    ? String(input.status)
    : "DRAFT";
  const data = {
    title,
    slug: slugify(optionalText(input.slug, 180) || title),
    summary: optionalText(input.summary, 500),
    content,
    videoUrl: validVideoUrl(input.videoUrl),
    status,
    categoryId: uuid(input.categoryId, "Categoria"),
    authorId: context.authUser.id,
    publishedAt: status === "PUBLISHED" ? new Date().toISOString() : null,
  };
  const { data: created, error } = await context.client
    .from("Article")
    .insert(data)
    .select("*")
    .single();
  if (error || !created)
    fail(400, error?.message ?? "Não foi possível criar o artigo.");
  return articleById(context.client, created.id);
}

async function updateArticle(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
  id: string,
) {
  const input = await bodyOf(request);
  const data: Record<string, unknown> = {};
  if (input.title !== undefined)
    data.title = text(input.title, "Título", 3, 180);
  if (input.slug !== undefined)
    data.slug = slugify(text(input.slug, "Slug", 2, 180));
  if (input.summary !== undefined)
    data.summary = optionalText(input.summary, 500);
  if (input.content !== undefined)
    data.content = text(input.content, "Conteúdo", 1, 100000);
  if (input.videoUrl !== undefined)
    data.videoUrl = validVideoUrl(input.videoUrl);
  if (input.categoryId !== undefined)
    data.categoryId = uuid(input.categoryId, "Categoria");
  if (input.status !== undefined) {
    const status = String(input.status);
    if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status))
      fail(400, "Status inválido.");
    data.status = status;
    data.publishedAt = status === "PUBLISHED" ? new Date().toISOString() : null;
  }
  const { data: updated, error } = await context.client
    .from("Article")
    .update(data)
    .eq("id", uuid(id, "Artigo"))
    .select("id")
    .single();
  if (error || !updated)
    fail(400, error?.message ?? "Não foi possível atualizar o artigo.");
  return articleById(context.client, updated.id);
}

async function categoryMutation(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
  id?: string,
) {
  const input = await bodyOf(request);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = text(input.name, "Nome", 2, 120);
  if (input.slug !== undefined)
    data.slug = slugify(text(input.slug, "Slug", 2, 140));
  if (input.description !== undefined)
    data.description = optionalText(input.description, 500);
  if (input.parentId !== undefined)
    data.parentId = input.parentId
      ? uuid(input.parentId, "Categoria pai")
      : null;
  if (input.sortOrder !== undefined)
    data.sortOrder = Math.max(0, Number(input.sortOrder) || 0);
  if (input.active !== undefined) data.active = Boolean(input.active);
  if (id && data.parentId === id)
    fail(400, "Uma categoria não pode ser pai dela mesma.");
  const query = id
    ? context.client
        .from("Category")
        .update(data)
        .eq("id", uuid(id, "Categoria"))
    : context.client.from("Category").insert({
        name: text(input.name, "Nome", 2, 120),
        slug: slugify(text(input.slug, "Slug", 2, 140)),
        description: optionalText(input.description, 500),
        parentId: input.parentId ? uuid(input.parentId, "Categoria pai") : null,
        sortOrder: Math.max(0, Number(input.sortOrder) || 0),
      });
  const { data: result, error } = await query.select("*").single();
  if (error || !result)
    fail(400, error?.message ?? "Não foi possível salvar a categoria.");
  return result;
}

async function companies(client: ReturnType<typeof publicClient>) {
  const { data, error } = await client
    .from("Company")
    .select("*")
    .order("name");
  if (error) fail(500, "Não foi possível carregar as empresas.");
  const ids = (data ?? []).map((item) => item.id);
  const [users, permissions] = await Promise.all([
    ids.length
      ? client.from("User").select("id,companyId").in("companyId", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? client
          .from("CompanyCategoryPermission")
          .select("id,companyId")
          .in("companyId", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  return (data ?? []).map((item) => ({
    ...item,
    _count: {
      users: (users.data ?? []).filter((user) => user.companyId === item.id)
        .length,
      categoryPermissions: (permissions.data ?? []).filter(
        (permission) => permission.companyId === item.id,
      ).length,
    },
  }));
}

async function usersByCompany(
  client: ReturnType<typeof publicClient>,
  companyId: string,
) {
  const { data, error } = await client
    .from("User")
    .select("*")
    .eq("companyId", uuid(companyId, "Empresa"))
    .order("name");
  if (error) fail(500, "Não foi possível carregar os usuários.");
  return data ?? [];
}

function role(value: unknown) {
  const result = String(value || "CLIENT_VIEWER");
  if (!["CLIENT_ADMIN", "CLIENT_EDITOR", "CLIENT_VIEWER"].includes(result))
    fail(400, "Perfil de cliente inválido.");
  return result;
}

async function createUser(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
  companyId: string,
) {
  const input = await bodyOf(request);
  const userEmail = email(input.email);
  const password =
    optionalText(input.temporaryPassword, 120) || temporaryPassword();
  if (password.length < 8)
    fail(400, "A senha temporária precisa ter pelo menos 8 caracteres.");
  const admin = adminClient();
  const authResult = await admin.auth.admin.createUser({
    email: userEmail,
    password,
    email_confirm: true,
  });
  if (authResult.error || !authResult.data.user)
    fail(400, authResult.error?.message ?? "Não foi possível criar o acesso.");
  const row = {
    id: authResult.data.user.id,
    companyId: uuid(companyId, "Empresa"),
    name: text(input.name, "Nome", 2, 120),
    email: userEmail,
    role: role(input.role),
    mustChangePassword: true,
    active: true,
  };
  const { data: profile, error } = await admin
    .from("User")
    .insert(row)
    .select("*")
    .single();
  if (error || !profile) {
    await admin.auth.admin.deleteUser(authResult.data.user.id);
    fail(400, error?.message ?? "Não foi possível criar o perfil.");
  }
  return {
    user: outputProfile(profile, await companyFor(admin, profile.companyId)),
    temporaryPassword: password,
  };
}

async function updateUser(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
  id: string,
) {
  const userId = uuid(id, "Usuário");
  const input = await bodyOf(request);
  const admin = adminClient();
  const { data: current } = await admin
    .from("User")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (!current) fail(404, "Usuário não encontrado.");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = text(input.name, "Nome", 2, 120);
  if (input.active !== undefined) data.active = Boolean(input.active);
  const reset =
    input.resetTemporaryPassword === true ||
    input.resetTemporaryPassword === "true" ||
    input.temporaryPassword !== undefined;
  let password: string | undefined;
  if (reset) {
    password =
      optionalText(input.temporaryPassword, 120) || temporaryPassword();
    if (password.length < 8)
      fail(400, "A senha temporária precisa ter pelo menos 8 caracteres.");
    const authResult = await admin.auth.admin.updateUserById(userId, {
      password,
    });
    if (authResult.error) fail(400, "Não foi possível redefinir a senha.");
    data.mustChangePassword = true;
    data.passwordChangedAt = null;
  }
  const { data: profile, error } = await admin
    .from("User")
    .update(data)
    .eq("id", userId)
    .select("*")
    .single();
  if (error || !profile)
    fail(400, error?.message ?? "Não foi possível atualizar o usuário.");
  return {
    user: outputProfile(profile, await companyFor(admin, profile.companyId)),
    ...(password ? { temporaryPassword: password } : {}),
  };
}

async function accessRequest(request: Request) {
  const input = await bodyOf(request);
  const requestEmail = email(input.email);
  const admin = adminClient();
  const duplicate = await admin
    .from("AccessRequest")
    .select("id")
    .eq("status", "PENDING")
    .ilike("email", requestEmail)
    .maybeSingle();
  if (duplicate.data)
    fail(409, "Já existe uma solicitação pendente para este e-mail.");
  const { data, error } = await admin
    .from("AccessRequest")
    .insert({
      name: text(input.name, "Nome", 2, 120),
      email: requestEmail,
      companyName: text(input.companyName, "Empresa", 2, 160),
      companyDocument: optionalText(input.companyDocument, 30),
      message: optionalText(input.message, 1000),
      status: "PENDING",
    })
    .select("id,status")
    .single();
  if (error || !data)
    fail(400, error?.message ?? "Não foi possível enviar a solicitação.");
  return data;
}

async function approveRequest(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
  id: string,
) {
  const input = await bodyOf(request);
  const requestId = uuid(id, "Solicitação");
  const { data: pending } = await context.client
    .from("AccessRequest")
    .select("*")
    .eq("id", requestId)
    .eq("status", "PENDING")
    .maybeSingle();
  if (!pending) fail(404, "Solicitação pendente não encontrada.");
  const password =
    optionalText(input.temporaryPassword, 120) || temporaryPassword();
  const admin = adminClient();
  const authResult = await admin.auth.admin.createUser({
    email: pending.email,
    password,
    email_confirm: true,
  });
  if (authResult.error || !authResult.data.user)
    fail(400, authResult.error?.message ?? "Não foi possível criar o acesso.");
  const profile = {
    id: authResult.data.user.id,
    companyId: uuid(input.companyId, "Empresa"),
    name: pending.name,
    email: pending.email,
    role: role(input.role),
    mustChangePassword: true,
    active: true,
  };
  const profileResult = await admin
    .from("User")
    .insert(profile)
    .select("*")
    .single();
  if (profileResult.error || !profileResult.data) {
    await admin.auth.admin.deleteUser(authResult.data.user.id);
    fail(
      400,
      profileResult.error?.message ?? "Não foi possível criar o perfil.",
    );
  }
  const requestResult = await admin
    .from("AccessRequest")
    .update({
      status: "APPROVED",
      reviewedAt: new Date().toISOString(),
      reviewedById: context.authUser.id,
    })
    .eq("id", requestId)
    .eq("status", "PENDING");
  if (requestResult.error)
    fail(500, "Usuário criado, mas a solicitação não foi atualizada.");
  return {
    user: outputProfile(
      profileResult.data,
      await companyFor(admin, profileResult.data.companyId),
    ),
    temporaryPassword: password,
  };
}

async function rejectRequest(
  request: Request,
  context: Awaited<ReturnType<typeof contextOf>>,
  id: string,
) {
  const input = await bodyOf(request);
  const { data, error } = await context.client
    .from("AccessRequest")
    .update({
      status: "REJECTED",
      rejectionReason: optionalText(input.reason, 500),
      reviewedAt: new Date().toISOString(),
      reviewedById: context.authUser.id,
    })
    .eq("id", uuid(id, "Solicitação"))
    .eq("status", "PENDING")
    .select("id,status")
    .maybeSingle();
  if (error || !data) fail(404, "Solicitação pendente não encontrada.");
  return data;
}

async function handle(request: Request) {
  assertRuntimeConfig();
  const url = new URL(request.url);
  const marker = "/functions/v1/api";
  let path = url.pathname.includes(marker)
    ? url.pathname.slice(url.pathname.indexOf(marker) + marker.length)
    : url.pathname;
  if (path.startsWith("/api")) path = path.slice(4);
  const parts = path.split("/").filter(Boolean);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return json(request, { ok: true });
  if (parts[0] === "auth" && parts[1] === "login" && method === "POST")
    return json(request, await login(request));
  if (parts[0] === "access-requests" && parts.length === 1 && method === "POST")
    return json(request, await accessRequest(request), 201);

  if (parts[0] === "auth" && parts[1] === "me" && method === "GET")
    return json(request, await currentUser(request));
  if (
    parts[0] === "auth" &&
    parts[1] === "change-password" &&
    method === "POST"
  )
    return json(request, await changePassword(request));
  if (parts[0] === "auth" && parts[1] === "logout")
    return json(request, { ok: true });

  const context = await contextOf(request);
  if (parts[0] === "categories" && parts.length === 1 && method === "GET")
    return json(request, await categories(context.client));
  if (parts[0] === "categories" && parts.length === 1 && method === "POST")
    return json(
      request,
      await categoryMutation(request, requireAdmin(context)),
      201,
    );
  if (parts[0] === "categories" && parts.length === 2 && method === "PATCH")
    return json(
      request,
      await categoryMutation(request, requireAdmin(context), parts[1]),
    );
  if (parts[0] === "categories" && parts.length === 2 && method === "DELETE")
    return json(
      request,
      await categoryMutation(
        new Request(request.url, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
          headers: { "Content-Type": "application/json" },
        }),
        requireAdmin(context),
        parts[1],
      ),
    );

  if (parts[0] === "articles" && parts.length === 1 && method === "GET")
    return json(request, await articles(context.client, url));
  if (parts[0] === "articles" && parts.length === 1 && method === "POST")
    return json(
      request,
      await createArticle(request, requireAdmin(context)),
      201,
    );
  if (parts[0] === "articles" && parts.length === 2 && method === "GET")
    return json(
      request,
      await articleById(context.client, uuid(parts[1], "Artigo")),
    );
  if (parts[0] === "articles" && parts.length === 2 && method === "PATCH")
    return json(
      request,
      await updateArticle(request, requireAdmin(context), parts[1]),
    );
  if (parts[0] === "articles" && parts.length === 2 && method === "DELETE")
    return json(
      request,
      await updateArticle(
        new Request(request.url, {
          method: "PATCH",
          body: JSON.stringify({ status: "ARCHIVED" }),
          headers: { "Content-Type": "application/json" },
        }),
        requireAdmin(context),
        parts[1],
      ),
    );

  if (parts[0] === "companies" && parts.length === 1 && method === "GET")
    return json(request, await companies(requireAdmin(context).client));
  if (parts[0] === "companies" && parts.length === 1 && method === "POST") {
    const input = await bodyOf(request);
    const { data, error } = await requireAdmin(context)
      .client.from("Company")
      .insert({
        name: text(input.name, "Nome", 2, 160),
        document: optionalText(input.document, 30),
      })
      .select("*")
      .single();
    if (error || !data)
      fail(400, error?.message ?? "Não foi possível criar a empresa.");
    return json(request, data, 201);
  }
  if (parts[0] === "companies" && parts.length === 2 && method === "PATCH") {
    const input = await bodyOf(request);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = text(input.name, "Nome", 2, 160);
    if (input.document !== undefined)
      data.document = optionalText(input.document, 30);
    if (input.active !== undefined) data.active = Boolean(input.active);
    const { data: result, error } = await requireAdmin(context)
      .client.from("Company")
      .update(data)
      .eq("id", uuid(parts[1], "Empresa"))
      .select("*")
      .single();
    if (error || !result)
      fail(400, error?.message ?? "Não foi possível atualizar a empresa.");
    return json(request, result);
  }
  if (parts[0] === "companies" && parts[2] === "users" && method === "GET")
    return json(
      request,
      await usersByCompany(requireAdmin(context).client, parts[1]),
    );
  if (parts[0] === "companies" && parts[2] === "users" && method === "POST")
    return json(
      request,
      await createUser(request, requireAdmin(context), parts[1]),
      201,
    );
  if (
    parts[0] === "companies" &&
    parts[2] === "category-permissions" &&
    method === "GET"
  ) {
    const { data, error } = await requireAdmin(context)
      .client.from("CompanyCategoryPermission")
      .select("*")
      .eq("companyId", uuid(parts[1], "Empresa"));
    if (error) fail(500, "Não foi possível carregar as permissões.");
    return json(request, data ?? []);
  }
  if (
    parts[0] === "companies" &&
    parts[2] === "category-permissions" &&
    method === "PUT"
  ) {
    const input = await bodyOf(request);
    const companyId = uuid(parts[1], "Empresa");
    const client = requireAdmin(context).client;
    const deleted = await client
      .from("CompanyCategoryPermission")
      .delete()
      .eq("companyId", companyId);
    if (deleted.error) fail(400, "Não foi possível substituir as permissões.");
    const ids = Array.isArray(input.categoryIds)
      ? input.categoryIds.map((item) => uuid(item, "Categoria"))
      : [];
    if (ids.length) {
      const inserted = await client
        .from("CompanyCategoryPermission")
        .insert(
          ids.map((categoryId) => ({ companyId, categoryId, canView: true })),
        );
      if (inserted.error) fail(400, inserted.error.message);
    }
    return json(request, { ok: true });
  }

  if (parts[0] === "users" && parts.length === 2 && method === "PATCH")
    return json(
      request,
      await updateUser(request, requireAdmin(context), parts[1]),
    );
  if (parts[0] === "users" && parts.length === 2 && method === "DELETE")
    return json(
      request,
      await updateUser(
        new Request(request.url, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
          headers: { "Content-Type": "application/json" },
        }),
        requireAdmin(context),
        parts[1],
      ),
    );

  if (
    parts[0] === "access-requests" &&
    parts.length === 1 &&
    method === "GET"
  ) {
    const { data, error } = await requireAdmin(context)
      .client.from("AccessRequest")
      .select("*")
      .order("createdAt", { ascending: false });
    if (error) fail(500, "Não foi possível carregar as solicitações.");
    return json(request, data ?? []);
  }
  if (
    parts[0] === "access-requests" &&
    parts[2] === "approve" &&
    method === "POST"
  )
    return json(
      request,
      await approveRequest(request, requireAdmin(context), parts[1]),
    );
  if (
    parts[0] === "access-requests" &&
    parts[2] === "reject" &&
    method === "POST"
  )
    return json(
      request,
      await rejectRequest(request, requireAdmin(context), parts[1]),
    );

  fail(404, "Rota não encontrada.");
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    if (error instanceof HttpError)
      return json(request, { message: error.message }, error.status);
    console.error(error);
    return json(
      request,
      { message: "Erro interno ao processar a solicitação." },
      500,
    );
  }
});
