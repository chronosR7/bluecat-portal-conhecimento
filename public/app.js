(() => {
  "use strict";

  // Frontend estático: o GitHub Pages entrega os arquivos e o Supabase executa
  // Auth, RLS e a Edge Function que substitui a API NestJS em produção.
  const config = window.BLUECAT_CONFIG || {};
  const SUPABASE_URL = String(config.SUPABASE_URL || "").replace(/\/$/, "");
  const SUPABASE_ANON_KEY = String(config.SUPABASE_ANON_KEY || "");
  const API_BASE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/api` : "";
  const supabaseClient =
    window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;
  const hasSupabaseConfig = Boolean(
    supabaseClient &&
    !SUPABASE_URL.includes("SEU-PROJETO") &&
    !SUPABASE_ANON_KEY.includes("COLE_A_CHAVE"),
  );
  const isLocalLegacy =
    !hasSupabaseConfig &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const isConfigured = hasSupabaseConfig || isLocalLegacy;
  const assetUrl = (path) => new URL(path, document.baseURI).href;
  const app = document.getElementById("app");
  // O SDK do Supabase gerencia a sessão; o estado abaixo guarda somente dados de tela.
  const state = {
    user: null,
    categories: [],
    articles: [],
    companies: [],
    activeView: "home",
    selectedCategory: "",
    search: "",
    openCategories: new Set(),
    activeArticleId: "",
    activeArticle: null,
    activeCategoryId: "",
    articleOrder: [],
  };

  // Rótulos exibidos na interface para os enums vindos do backend.
  const roleLabels = {
    PLATFORM_ADMIN: "Administrador da plataforma",
    CLIENT_ADMIN: "Administrador do cliente",
    CLIENT_EDITOR: "Editor do cliente",
    CLIENT_VIEWER: "Leitor",
  };

  const iconForCategory = [
    "bi-grid-1x2",
    "bi-box-seam",
    "bi-sliders",
    "bi-journal-text",
    "bi-lightning-charge",
  ];
  const SUPPORT_EMAIL = "suporte@bluecatsystems.com.br";

  function escapeHtml(value) {
    // Todo valor vindo da API passa por aqui antes de entrar em innerHTML.
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initials(name) {
    return String(name || "BC")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function formatDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  }

  function roleLabel(role) {
    return roleLabels[role] || role || "Usuário";
  }

  function articleStatus(status) {
    const labels = {
      PUBLISHED: "Publicado",
      DRAFT: "Rascunho",
      ARCHIVED: "Arquivado",
    };
    const classes = {
      PUBLISHED: "status-published",
      DRAFT: "status-draft",
      ARCHIVED: "status-archived",
    };
    return `<span class="status-badge ${classes[status] || "status-archived"}">${labels[status] || status}</span>`;
  }

  function categoryName(categoryId) {
    return (
      state.categories.find((category) => category.id === categoryId)?.name ||
      "Sem categoria"
    );
  }

  function categoryPath(category) {
    if (!category) return "Sem categoria";
    const parent = category.parentId
      ? state.categories.find((item) => item.id === category.parentId)
      : null;
    return parent ? `${parent.name} / ${category.name}` : category.name;
  }

  function youtubeEmbedUrl(value) {
    // Aceita formatos comuns do YouTube, mas sempre converte para youtube-nocookie.
    if (!value) return "";
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      const segments = url.pathname.split("/").filter(Boolean);
      const videoId =
        hostname === "youtu.be"
          ? segments[0]
          : url.searchParams.get("v") ||
            (segments[0] && ["embed", "shorts", "live"].includes(segments[0])
              ? segments[1]
              : "");
      return videoId && /^[\w-]{6,100}$/.test(videoId)
        ? `https://www.youtube-nocookie.com/embed/${videoId}`
        : "";
    } catch {
      return "";
    }
  }

  async function api(path, options = {}) {
    // Cliente HTTP único: injeta o JWT do Supabase e centraliza erros da Edge Function.
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    let response;
    if (hasSupabaseConfig) {
      // O login começa sem sessão; consultar getSession antes dele pode tentar
      // renovar um token antigo e mascarar o erro real como "Failed to fetch".
      if (path !== "/auth/login") {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        if (sessionData.session?.access_token)
          headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      }
      headers.apikey = SUPABASE_ANON_KEY;
      try {
        response = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers,
          credentials: "omit",
        });
      } catch {
        throw new Error(
          "Não foi possível conectar ao serviço de autenticação.",
        );
      }
    } else {
      // Compatibilidade local: o NestJS continua disponível em localhost.
      response = await fetch(`/api${path}`, {
        ...options,
        headers,
        credentials: "include",
      });
    }
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw;
    }
    if (
      hasSupabaseConfig &&
      path === "/auth/login" &&
      response.ok &&
      payload?.session
    ) {
      await supabaseClient.auth.setSession(payload.session);
    }
    if (response.status === 401) {
      const isLoginRequest = path === "/auth/login";
      const isPasswordChangeRequest = path === "/auth/change-password";
      const isLogoutRequest = path === "/auth/logout";
      if (
        state.user &&
        !isLoginRequest &&
        !isPasswordChangeRequest &&
        !isLogoutRequest
      ) {
        void logout(false);
        throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      }
      throw new Error(
        payload?.message ||
          (isPasswordChangeRequest
            ? "A senha atual é inválida."
            : "E-mail ou senha inválidos."),
      );
    }
    if (!response.ok) {
      const message = Array.isArray(payload?.message)
        ? payload.message.join(" ")
        : payload?.message;
      throw new Error(message || "Não foi possível concluir a operação.");
    }
    return payload;
  }

  function jsonOptions(method, body) {
    return { method, body: JSON.stringify(body) };
  }

  function toast(message, type = "success") {
    // Feedback curto para ações administrativas e respostas do fluxo público.
    const colors = {
      success: "text-bg-success",
      danger: "text-bg-danger",
      info: "text-bg-primary",
    };
    const region = document.getElementById("toast-region");
    if (!region) return;
    const element = document.createElement("div");
    element.className = `toast align-items-center border-0 ${colors[type] || colors.info}`;
    element.setAttribute("role", "alert");
    element.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button></div>`;
    region.appendChild(element);
    const instance = new bootstrap.Toast(element, { delay: 4200 });
    element.addEventListener("hidden.bs.toast", () => element.remove());
    instance.show();
  }

  async function logout(showMessage = true) {
    // O SDK encerra a sessão local e invalida o refresh token no Supabase Auth.
    try {
      if (hasSupabaseConfig) await supabaseClient.auth.signOut();
      else
        await fetch(`/api/auth/logout`, {
          method: "POST",
          credentials: "include",
        });
    } catch {
      /* a tela ainda será limpa */
    }
    state.user = null;
    state.categories = [];
    state.articles = [];
    state.companies = [];
    state.openCategories.clear();
    state.activeArticleId = "";
    state.activeArticle = null;
    state.activeCategoryId = "";
    state.articleOrder = [];
    renderLogin();
    if (showMessage) toast("Você saiu do portal.", "info");
  }

  function setActiveNav(view) {
    document
      .querySelectorAll("#main-nav a")
      .forEach((item) =>
        item.classList.toggle("active", item.dataset.view === view),
      );
  }

  function supportMailto() {
    const subject = "Solicitação de suporte - Portal de Conhecimento";
    const body = `Olá, equipe BlueCat.\n\nEmpresa: ${state.user?.company?.name || ""}\nUsuário: ${state.user?.name || ""}\n\nDescreva sua necessidade:`;
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function showSupport() {
    // Página simples de contato; o cliente não abre chamados dentro do banco.
    setActiveNav("support");
    const main = document.getElementById("main-view");
    if (!main) return;
    main.innerHTML = `<div class="support-page"><div class="client-portal-heading"><span class="eyebrow">Estamos por aqui</span><h1 class="page-title">Fale com a gente</h1><p class="page-lead">Conte o que você precisa e a equipe BlueCat ajuda a encontrar o melhor caminho.</p></div><div class="support-card"><div class="support-card-mark"><i class="bi bi-chat-left-text"></i></div><div><span class="eyebrow">Atendimento BlueCat</span><h2>Vamos resolver isso juntos</h2><p>Ao clicar abaixo, o seu aplicativo de e-mail abre uma mensagem já preparada. É só explicar o que aconteceu e enviar.</p><a class="btn btn-primary" href="${escapeHtml(supportMailto())}"><i class="bi bi-envelope me-2"></i>Escrever para o suporte</a><small> ${escapeHtml(SUPPORT_EMAIL)}</small></div></div><div class="support-note"><i class="bi bi-info-circle"></i><span>Se precisar de um novo usuário ou de acesso a outra categoria, escreva para a equipe BlueCat. Nós cuidamos disso para você.</span></div></div>`;
  }

  function renderLogin() {
    // Tela pública: permite entrar ou solicitar um novo acesso para análise da BlueCat.
    if (!isConfigured) {
      app.innerHTML = `<main class="login-screen"><div class="login-card"><span class="eyebrow">Configuração necessária</span><h1 class="mt-2">Portal ainda não conectado</h1><p class="text-muted">Edite o arquivo <code>public/config.js</code> com a URL e a chave pública do Supabase antes de publicar.</p></div></main>`;
      return;
    }
    app.innerHTML = `
      <main class="login-screen">
        <div class="container login-panel">
          <div class="row justify-content-center">
            <div class="col-12 col-sm-10 col-md-7 col-lg-5 col-xl-4">
              <div class="login-brand">
                <img src="${assetUrl("assets/bluecat-logo.png")}" alt="Logo BlueCat Systems" />
                <h1>BlueCat Systems</h1>
                <p>Portal de Conhecimento</p>
              </div>
              <section class="login-card">
                <div class="mb-4"><span class="eyebrow">Portal BlueCat</span><h2 class="mt-2 mb-1">Vamos começar?</h2><p class="text-muted small mb-0">Entre para encontrar os procedimentos e tutoriais do seu ERP.</p></div>
                <div id="login-alert"></div>
                <form id="login-form" novalidate>
                  <div class="mb-3"><label class="form-label" for="login-email">E-mail</label><input class="form-control" id="login-email" type="email" autocomplete="email" placeholder="voce@empresa.com.br" required /></div>
                  <div class="mb-4"><div class="d-flex justify-content-between"><label class="form-label" for="login-password">Senha</label><span class="small text-muted">Use seu acesso corporativo</span></div><input class="form-control" id="login-password" type="password" autocomplete="current-password" placeholder="Digite sua senha" minlength="8" required /></div>
                  <button class="btn btn-primary w-100" id="login-submit" type="submit"><span>Entrar</span><i class="bi bi-arrow-right ms-2"></i></button>
                </form>
                <div class="login-request-access"><a class="btn btn-link p-0" href="forgot-password.html">Esqueci minha senha</a><span class="text-muted">·</span><button type="button" class="btn btn-link p-0" id="request-access">Solicitar login</button></div>
              </section>
              <p class="text-center text-muted mt-4 small">BlueCat Systems</p>
            </div>
          </div>
        </div>
      </main>`;

    document
      .getElementById("login-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = document
          .getElementById("login-email")
          .value.trim()
          .toLowerCase();
        const password = document.getElementById("login-password").value;
        const submit = document.getElementById("login-submit");
        if (!email || !password) return;
        submit.disabled = true;
        submit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Entrando...`;
        try {
          const result = await api(
            "/auth/login",
            jsonOptions("POST", { email, password }),
          );
          state.user = result.user;
          renderPortal();
          await showHome();
          if (result.mustChangePassword)
            setTimeout(() => openPasswordModal(true), 350);
        } catch (error) {
          const alert = document.getElementById("login-alert");
          if (alert)
            alert.innerHTML = `<div class="alert alert-danger py-2 mb-3">${escapeHtml(error.message)}</div>`;
          submit.disabled = false;
          submit.innerHTML = `<span>Entrar</span><i class="bi bi-arrow-right ms-2"></i>`;
        }
      });
    document
      .getElementById("request-access")
      .addEventListener("click", openAccessRequestModal);
  }

  function openAccessRequestModal() {
    // O solicitante informa apenas dados de contato; empresa e perfil são definidos pelo admin.
    openModal(
      "Solicitar acesso",
      `<p class="text-muted small">Preencha seus dados. A equipe BlueCat vai analisar o pedido e liberar o acesso para a empresa correta.</p><div id="access-request-alert"></div><form id="access-request-form"><div class="row g-3"><div class="col-md-6"><label class="form-label" for="request-name">Nome</label><input class="form-control" id="request-name" name="name" required minlength="2" maxlength="120" autocomplete="name" /></div><div class="col-md-6"><label class="form-label" for="request-email">E-mail corporativo</label><input class="form-control" id="request-email" name="email" type="email" required maxlength="254" autocomplete="email" /></div><div class="col-12"><label class="form-label" for="request-company">Empresa</label><input class="form-control" id="request-company" name="companyName" required minlength="2" maxlength="160" autocomplete="organization" /></div><div class="col-12"><label class="form-label" for="request-document">CNPJ ou documento <span class="fw-normal text-muted">(opcional)</span></label><input class="form-control" id="request-document" name="companyDocument" maxlength="30" /></div><div class="col-12"><label class="form-label" for="request-message">Como podemos ajudar? <span class="fw-normal text-muted">(opcional)</span></label><textarea class="form-control" id="request-message" name="message" maxlength="1000" rows="3" placeholder="Ex.: preciso acompanhar os procedimentos de cadastro."></textarea></div></div></form>`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Voltar</button><button type="submit" form="access-request-form" class="btn btn-primary" id="access-request-submit">Enviar solicitação</button>`,
    );
    document
      .getElementById("access-request-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = document.getElementById("access-request-submit");
        const alert = document.getElementById("access-request-alert");
        const body = Object.fromEntries(new FormData(event.target).entries());
        submit.disabled = true;
        submit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Enviando...`;
        try {
          await api("/access-requests", jsonOptions("POST", body));
          closeModal();
          toast("Solicitação enviada. Aguarde o retorno da equipe BlueCat.");
        } catch (error) {
          alert.innerHTML = `<div class="alert alert-danger py-2">${escapeHtml(error.message)}</div>`;
          submit.disabled = false;
          submit.textContent = "Enviar solicitação";
        }
      });
  }

  function renderPortal() {
    // Cabeçalho e navegação mudam conforme o perfil, mas autorização real fica no backend.
    const isAdmin = state.user?.role === "PLATFORM_ADMIN";
    app.innerHTML = `
      <div class="portal-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a href="#" class="brand-lockup" id="brand-home"><img src="${assetUrl("assets/bluecat-logo.png")}" alt="BlueCat Systems" /><span><span class="brand-name">BlueCat Systems</span><span class="brand-subtitle">Portal de Conhecimento</span></span></a>
            <nav class="main-nav" id="main-nav">
              <a class="active" data-view="home">Início</a><a data-view="support">Suporte</a>
              ${isAdmin ? `<a data-view="admin-articles">Gerenciar artigos</a><a data-view="categories">Categorias e acessos</a><a data-view="companies">Empresas</a>` : ""}
              ${isAdmin ? `<a data-view="users">Usuários</a><a data-view="access-requests">Solicitações</a>` : ""}
            </nav>
            <form class="topbar-search" id="top-search"><div class="input-group"><span class="input-group-text"><i class="bi bi-search"></i></span><input class="form-control" id="top-search-input" placeholder="Buscar procedimento" aria-label="Buscar procedimento" /><button class="topbar-search-submit" type="submit" aria-label="Buscar"><i class="bi bi-arrow-right"></i></button></div></form>
            <div class="dropdown account-menu"><button class="account-trigger" data-bs-toggle="dropdown" aria-label="Abrir menu da conta"><div class="account-avatar">${escapeHtml(initials(state.user?.name))}</div><div class="account-copy"><span class="account-name">${escapeHtml(state.user?.name)}</span><span class="account-role">${escapeHtml(roleLabel(state.user?.role))}</span></div></button><ul class="dropdown-menu dropdown-menu-end shadow-sm"><li><button class="dropdown-item" id="change-password">Alterar senha</button></li><li><hr class="dropdown-divider" /></li><li><button class="dropdown-item text-danger" id="logout-button">Sair</button></li></ul></div>
            <button class="mobile-menu-button" id="mobile-menu" aria-label="Abrir menu">Menu</button>
          </div>
        </header>
        <main class="main-content"><div class="content-wrap" id="main-view"></div></main>
      </div>`;

    document.getElementById("brand-home").addEventListener("click", (event) => {
      event.preventDefault();
      showHome();
    });
    document.getElementById("logout-button").addEventListener("click", () => {
      void logout();
    });
    document
      .getElementById("change-password")
      .addEventListener("click", () => openPasswordModal(false));
    document
      .getElementById("mobile-menu")
      .addEventListener("click", () =>
        document.getElementById("main-nav").classList.toggle("open"),
      );
    document
      .getElementById("top-search")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        state.search = document.getElementById("top-search-input").value.trim();
        showArticles();
      });
    document.getElementById("main-nav").addEventListener("click", (event) => {
      const link = event.target.closest("[data-view]");
      if (!link) return;
      event.preventDefault();
      document
        .querySelectorAll("#main-nav a")
        .forEach((item) => item.classList.toggle("active", item === link));
      document.getElementById("main-nav").classList.remove("open");
      state.activeView = link.dataset.view;
      (
        ({
          home: showHome,
          support: showSupport,
          articles: showArticles,
          "admin-articles": showAdminArticles,
          categories: showCategoriesAdmin,
          companies: showCompaniesAdmin,
          users: showUsersAdmin,
          "access-requests": showAccessRequestsAdmin,
        })[state.activeView] || showHome
      )();
    });
  }

  async function loadCategories() {
    state.categories = await api("/categories");
  }

  // ========================= Portal do administrador =========================
  async function showHome() {
    // Home administrativa resume artigos e categorias; clientes seguem direto para o explorer.
    if (state.user?.role !== "PLATFORM_ADMIN") return showClientExplorer();
    setActiveNav("home");
    state.activeView = "home";
    const main = document.getElementById("main-view");
    if (!main) return;
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Só um instante...</div>`;
    try {
      const [categories, articles] = await Promise.all([
        api("/categories"),
        api("/articles"),
      ]);
      state.categories = categories;
      state.articles = articles;
      const topCategories = categories
        .filter((category) => !category.parentId)
        .slice(0, 6);
      const recent = articles.slice(0, 4);
      const accessRequest =
        state.user?.role === "PLATFORM_ADMIN"
          ? ""
          : `<div class="access-request"><strong>Precisa de outro acesso?</strong><span>Solicite a criação de um novo usuário diretamente à equipe BlueCat.</span></div>`;
      main.innerHTML = `
        <div class="hero-card"><span class="eyebrow text-info">Base BlueCat</span><h1>Encontre o que precisa para seguir o trabalho.</h1><p>Passos simples para usar melhor as soluções BlueCat no dia a dia.</p><form class="hero-search" id="hero-search"><div class="input-group"><span class="input-group-text"><i class="bi bi-search"></i></span><input id="hero-search-input" class="form-control" placeholder="O que você precisa fazer?" /><button class="btn btn-primary" type="submit">Buscar</button></div></form></div>
        ${accessRequest}
        <div class="row g-3 mb-4"><div class="col-6 col-lg-3"><div class="stat-card"><div class="stat-icon"><i class="bi bi-journal-bookmark"></i></div><div class="stat-value">${articles.length}</div><div class="stat-label">Artigos disponíveis</div></div></div><div class="col-6 col-lg-3"><div class="stat-card"><div class="stat-icon"><i class="bi bi-grid"></i></div><div class="stat-value">${categories.length}</div><div class="stat-label">Categorias liberadas</div></div></div><div class="col-6 col-lg-3"><div class="stat-card"><div class="stat-icon"><i class="bi bi-check2-circle"></i></div><div class="stat-value">24/7</div><div class="stat-label">Acesso ao conhecimento</div></div></div><div class="col-6 col-lg-3"><div class="stat-card"><div class="stat-icon"><i class="bi bi-stars"></i></div><div class="stat-value">${state.user?.role === "PLATFORM_ADMIN" ? "Admin" : "Seu"}</div><div class="stat-label">Espaço personalizado</div></div></div></div>
        <div class="section-heading"><h2>Por onde você quer começar?</h2><span>${categories.length} assuntos disponíveis</span></div><div class="row g-3">${topCategories.length ? topCategories.map((category, index) => `<div class="col-12 col-sm-6 col-lg-4"><div class="category-card" data-category="${category.id}"><div class="category-icon"><i class="bi ${iconForCategory[index % iconForCategory.length]}"></i></div><h3>${escapeHtml(category.name)}</h3><p>${category._count?.articles ?? ""} artigos disponíveis <i class="bi bi-arrow-up-right float-end"></i></p></div></div>`).join("") : `<div class="col-12"><div class="panel-card empty-state"><i class="bi bi-folder2-open"></i><h3>Nenhuma categoria disponível</h3><p>As categorias liberadas para sua empresa aparecerão aqui.</p></div></div>`}</div>
        <div class="section-heading mt-5"><h2>O que há de novo</h2><button class="btn btn-sm btn-soft" id="see-all-articles">Ver todos <i class="bi bi-arrow-right ms-1"></i></button></div><div class="row g-3">${recent.length ? recent.map(articleCard).join("") : `<div class="col-12"><div class="panel-card empty-state"><i class="bi bi-journal-x"></i><h3>Ainda não há artigos publicados</h3><p>Novos conteúdos aparecerão neste espaço.</p></div></div>`}</div>`;
      document
        .getElementById("hero-search")
        .addEventListener("submit", (event) => {
          event.preventDefault();
          state.search = document
            .getElementById("hero-search-input")
            .value.trim();
          showArticles();
        });
      document.querySelectorAll("[data-category]").forEach((element) =>
        element.addEventListener("click", () => {
          state.selectedCategory = element.dataset.category;
          showArticles();
        }),
      );
      document
        .getElementById("see-all-articles")
        ?.addEventListener("click", showArticles);
      document
        .querySelectorAll("[data-article]")
        .forEach((element) =>
          element.addEventListener("click", () =>
            showArticle(element.dataset.article),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  function articleCard(article) {
    return `<div class="col-12 col-md-6"><article class="article-card" data-article="${article.id}"><span class="badge-category">${escapeHtml(categoryPath(article.category))}</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.summary || "Um passo a passo para ajudar no dia a dia.")}</p><div class="article-meta"><span><i class="bi bi-clock me-1"></i>${formatDate(article.updatedAt)}</span><span><i class="bi bi-person me-1"></i>${escapeHtml(article.author?.name || "BlueCat Systems")}</span></div></article></div>`;
  }

  // ========================= Portal do cliente =========================
  function clientArticleMatches(article) {
    if (!state.search) return true;
    const term = state.search.toLowerCase();
    return [article.title, article.summary, article.content]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(term));
  }

  // Monta índices em memória para desenhar a árvore sem repetir filtros no template.
  function prepareClientNavigator() {
    const categoryById = new Map(
      state.categories.map((category) => [category.id, category]),
    );
    const childrenByParent = new Map();
    state.categories.forEach((category) => {
      const parentId = category.parentId || null;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(category);
    });
    childrenByParent.forEach((children) =>
      children.sort((left, right) => {
        return (
          (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
          left.name.localeCompare(right.name, "pt-BR")
        );
      }),
    );

    const visibleArticles = state.articles.filter(clientArticleMatches);
    const visibleIds = new Set(visibleArticles.map((article) => article.id));
    const articlesByCategory = new Map();
    visibleArticles.forEach((article) => {
      if (!articlesByCategory.has(article.categoryId))
        articlesByCategory.set(article.categoryId, []);
      articlesByCategory.get(article.categoryId).push(article);
    });
    articlesByCategory.forEach((articles) =>
      articles.sort(
        (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
      ),
    );

    const categoriesWithContent = new Set();
    const categoryCounts = new Map();
    visibleArticles.forEach((article) => {
      const visited = new Set();
      let category = categoryById.get(article.categoryId);
      while (category && !visited.has(category.id)) {
        visited.add(category.id);
        categoriesWithContent.add(category.id);
        categoryCounts.set(
          category.id,
          (categoryCounts.get(category.id) || 0) + 1,
        );
        category = category.parentId
          ? categoryById.get(category.parentId)
          : null;
      }
    });

    if (!state.openCategories.size) {
      (childrenByParent.get(null) || []).forEach((category) =>
        state.openCategories.add(category.id),
      );
    }

    state.articleOrder = [];
    function walk(parentId = null, lineage = new Set()) {
      (childrenByParent.get(parentId) || []).forEach((category) => {
        if (lineage.has(category.id)) return;
        (articlesByCategory.get(category.id) || []).forEach((article) =>
          state.articleOrder.push(article),
        );
        const nextLineage = new Set(lineage);
        nextLineage.add(category.id);
        walk(category.id, nextLineage);
      });
    }
    walk();

    return {
      childrenByParent,
      articlesByCategory,
      categoriesWithContent,
      categoryCounts,
      visibleIds,
    };
  }

  // Renderiza categorias como pastas e artigos como arquivos, preservando a hierarquia.
  function clientTreeHtml(parentId, navigator, lineage = new Set()) {
    return (navigator.childrenByParent.get(parentId || null) || [])
      .map((category) => {
        if (state.search && !navigator.categoriesWithContent.has(category.id))
          return "";
        if (lineage.has(category.id)) return "";
        const open =
          state.openCategories.has(category.id) || Boolean(state.search);
        const directArticles =
          navigator.articlesByCategory.get(category.id) || [];
        const nextLineage = new Set(lineage);
        nextLineage.add(category.id);
        const children = clientTreeHtml(category.id, navigator, nextLineage);
        const articleRows = directArticles
          .map(
            (article) => `
        <button type="button" class="explorer-file ${article.id === state.activeArticleId ? "active" : ""}" data-explorer-article="${article.id}" title="Abrir ${escapeHtml(article.title)}">
          <i class="bi bi-file-earmark-text"></i><span>${escapeHtml(article.title)}</span>${article.videoUrl ? `<i class="bi bi-play-circle explorer-file-video" title="Possui vídeo"></i>` : ""}
        </button>`,
          )
          .join("");
        return `
        <div class="explorer-node">
          <button type="button" class="explorer-folder ${state.activeCategoryId === category.id ? "active" : ""}" data-category-toggle="${category.id}" aria-expanded="${open}">
            <i class="bi bi-chevron-${open ? "down" : "right"} explorer-chevron"></i><i class="bi bi-folder${open ? "2-open" : ""} explorer-folder-icon"></i><span>${escapeHtml(category.name)}</span><small>${navigator.categoryCounts.get(category.id) ?? 0}</small>
          </button>
          ${open ? `<div class="explorer-children">${articleRows}${children || (!directArticles.length ? `<div class="explorer-empty">Nenhum procedimento publicado aqui ainda.</div>` : "")}</div>` : ""}
        </div>`;
      })
      .join("");
  }

  function clientReaderPlaceholder() {
    return `<div class="reader-placeholder"><div class="reader-placeholder-mark"><i class="bi bi-folder2-open"></i></div><span class="eyebrow">Área de leitura</span><h2>Por onde começamos?</h2><p>Escolha um assunto ao lado. Você verá os procedimentos disponíveis e poderá abrir o passo a passo completo.</p><div class="reader-summary"><span>${state.articleOrder.length} procedimento(s) disponível(is)</span><span>${state.categories.length} assunto(s) liberado(s)</span></div></div>`;
  }

  function clientCategoryPreview(categoryId, navigator) {
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category) return clientReaderPlaceholder();
    const categoryById = new Map(
      state.categories.map((item) => [item.id, item]),
    );
    const categoryArticles = state.articleOrder.filter((article) => {
      const visited = new Set();
      let current = categoryById.get(article.categoryId);
      while (current && !visited.has(current.id)) {
        if (current.id === categoryId) return true;
        visited.add(current.id);
        current = current.parentId ? categoryById.get(current.parentId) : null;
      }
      return false;
    });
    const articleList = categoryArticles
      .map(
        (article) =>
          `<button type="button" class="category-preview-item" data-explorer-article="${article.id}"><i class="bi bi-file-earmark-text"></i><span><strong>${escapeHtml(article.title)}</strong><small>${escapeHtml(article.summary || "Abrir procedimento")}</small></span><i class="bi bi-arrow-right"></i></button>`,
      )
      .join("");
    return `<div class="category-preview"><div class="reader-breadcrumb"><i class="bi bi-folder2-open"></i><span>Assunto</span><span class="reader-breadcrumb-separator">/</span><span>${escapeHtml(category.name)}</span></div><span class="eyebrow">Procedimentos disponíveis</span><h2>${escapeHtml(category.name)}</h2><p class="category-preview-lead">${categoryArticles.length ? `Aqui estão os procedimentos disponíveis em ${escapeHtml(category.name)}.` : "Ainda não há conteúdo publicado neste assunto para sua empresa."}</p>${articleList ? `<div class="category-preview-list">${articleList}</div>` : `<div class="category-empty"><i class="bi bi-hourglass-split"></i><strong>Ainda não há conteúdo aqui</strong><span>Assim que a equipe BlueCat publicar um procedimento neste assunto, ele aparecerá nesta lista.</span></div>`}</div>`;
  }

  // Desenha o explorer e conecta os eventos de busca, pasta e artigo.
  function renderClientExplorer() {
    const main = document.getElementById("main-view");
    if (!main) return;
    const navigator = prepareClientNavigator();
    const tree = clientTreeHtml(null, navigator);
    main.innerHTML = `
      <div class="client-portal-heading"><span class="eyebrow">Portal BlueCat</span><h1 class="page-title">Vamos encontrar o que você precisa</h1><p class="page-lead">Abra um assunto e veja os procedimentos disponíveis, com passo a passo e vídeo quando houver.</p></div>
      <div class="client-explorer-toolbar"><div><strong>Escolha um assunto</strong><span>Comece por uma das categorias abaixo</span></div><form id="client-explorer-search" class="client-explorer-search"><i class="bi bi-search"></i><input id="client-search-input" value="${escapeHtml(state.search)}" placeholder="Buscar um procedimento" aria-label="Buscar um procedimento" />${state.search ? `<button type="button" id="clear-client-search" aria-label="Limpar busca"><i class="bi bi-x-lg"></i></button>` : ""}</form></div>
      <div class="client-explorer-layout">
        <aside class="explorer-panel" aria-label="Assuntos e procedimentos"><div class="explorer-panel-header"><div><span class="eyebrow">Conteúdos para você</span><h2>Assuntos</h2></div><span class="explorer-count">${state.articleOrder.length}</span></div><div class="explorer-tree">${tree || `<div class="explorer-empty explorer-empty-panel">Ainda não há procedimentos liberados para sua empresa.</div>`}</div></aside>
        <section class="reader-panel" id="client-reader" aria-live="polite">${state.activeArticle ? "" : state.activeCategoryId ? clientCategoryPreview(state.activeCategoryId, navigator) : clientReaderPlaceholder()}</section>
      </div>`;

    if (state.activeArticle) renderClientReader(state.activeArticle);
    document
      .getElementById("client-explorer-search")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        state.search = document
          .getElementById("client-search-input")
          .value.trim();
        state.activeArticleId = "";
        state.activeArticle = null;
        state.activeCategoryId = "";
        renderClientExplorer();
      });
    document
      .getElementById("clear-client-search")
      ?.addEventListener("click", () => {
        state.search = "";
        state.activeArticleId = "";
        state.activeArticle = null;
        state.activeCategoryId = "";
        renderClientExplorer();
      });
    main.querySelectorAll("[data-category-toggle]").forEach((button) =>
      button.addEventListener("click", () => {
        const categoryId = button.dataset.categoryToggle;
        if (state.openCategories.has(categoryId))
          state.openCategories.delete(categoryId);
        else state.openCategories.add(categoryId);
        state.activeArticleId = "";
        state.activeArticle = null;
        state.activeCategoryId = categoryId;
        renderClientExplorer();
      }),
    );
    main
      .querySelectorAll("[data-explorer-article]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          showClientArticle(button.dataset.explorerArticle),
        ),
      );
  }

  // Carrega somente categorias/artigos que a API já filtrou para a empresa do cliente.
  async function showClientExplorer(articleId = state.activeArticleId) {
    state.activeView = "articles";
    setActiveNav("home");
    const main = document.getElementById("main-view");
    if (!main) return;
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Carregando seus conteúdos...</div>`;
    try {
      const [categories, articles] = await Promise.all([
        api("/categories"),
        api("/articles"),
      ]);
      state.categories = categories;
      state.articles = articles;
      if (articleId && !articles.some((article) => article.id === articleId)) {
        state.activeArticleId = "";
        state.activeArticle = null;
        state.activeCategoryId = "";
        articleId = "";
      }
      renderClientExplorer();
      if (articleId) await loadClientArticle(articleId);
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  async function showClientArticle(id) {
    state.activeArticleId = id;
    state.activeArticle = null;
    state.activeCategoryId = "";
    if (!state.categories.length || !state.articles.length)
      return showClientExplorer(id);
    renderClientExplorer();
    await loadClientArticle(id);
  }

  async function loadClientArticle(id) {
    const reader = document.getElementById("client-reader");
    if (!reader) return;
    reader.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Abrindo procedimento...</div>`;
    try {
      const article = await api(`/articles/${id}`);
      if (state.activeArticleId !== id) return;
      state.activeArticle = article;
      renderClientReader(article);
    } catch (error) {
      reader.innerHTML = errorState(error.message);
    }
  }

  // Leitor do procedimento: conteúdo, vídeo opcional e navegação anterior/próximo.
  function renderClientReader(article) {
    const reader = document.getElementById("client-reader");
    if (!reader) return;
    const currentIndex = state.articleOrder.findIndex(
      (item) => item.id === article.id,
    );
    const previous =
      currentIndex > 0 ? state.articleOrder[currentIndex - 1] : null;
    const next =
      currentIndex >= 0 ? state.articleOrder[currentIndex + 1] : null;
    const videoUrl = youtubeEmbedUrl(article.videoUrl);
    reader.innerHTML = `<article class="reader-article"><div class="reader-breadcrumb"><i class="bi bi-folder2-open"></i><span>${escapeHtml(categoryPath(article.category))}</span><span class="reader-breadcrumb-separator">/</span><span>Artigo</span></div><div class="reader-article-topline"><span class="eyebrow">Procedimento ${currentIndex >= 0 ? `${currentIndex + 1} de ${state.articleOrder.length}` : ""}</span><span class="reader-updated">Atualizado em ${formatDate(article.updatedAt)}</span></div><h2>${escapeHtml(article.title)}</h2>${article.summary ? `<p class="reader-summary-text">${escapeHtml(article.summary)}</p>` : ""}${videoUrl ? `<div class="article-video reader-video"><iframe src="${videoUrl}" title="Vídeo do curso: ${escapeHtml(article.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>` : ""}<div class="article-body">${formatContent(article.content)}</div><div class="reader-navigation"><button type="button" class="reader-nav-button" data-client-article="${previous?.id || ""}" ${previous ? "" : "disabled"}><span><i class="bi bi-arrow-left"></i> Anterior</span><small>${escapeHtml(previous?.title || "Primeiro artigo")}</small></button><button type="button" class="reader-nav-button reader-nav-next" data-client-article="${next?.id || ""}" ${next ? "" : "disabled"}><span>Próximo <i class="bi bi-arrow-right"></i></span><small>${escapeHtml(next?.title || "Último artigo")}</small></button></div></article>`;
    reader.querySelectorAll("[data-client-article]").forEach((button) => {
      if (button.dataset.clientArticle)
        button.addEventListener("click", () =>
          showClientArticle(button.dataset.clientArticle),
        );
    });
  }

  // Lista administrativa com busca e filtro; cliente usa o explorer acima.
  async function showArticles() {
    if (state.user?.role !== "PLATFORM_ADMIN") return showClientExplorer();
    state.activeView = "articles";
    const main = document.getElementById("main-view");
    if (!main) return;
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Buscando conteúdos...</div>`;
    try {
      if (!state.categories.length) await loadCategories();
      const params = new URLSearchParams();
      if (state.search) params.set("search", state.search);
      if (state.selectedCategory)
        params.set("categoryId", state.selectedCategory);
      state.articles = await api(
        `/articles${params.toString() ? `?${params}` : ""}`,
      );
      const selected = state.selectedCategory
        ? categoryName(state.selectedCategory)
        : "Todos os artigos";
      main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4"><div><span class="eyebrow">Biblioteca BlueCat</span><h1 class="page-title">${escapeHtml(selected)}</h1><p class="page-lead mb-0">Pesquise tutoriais e encontre orientações para resolver suas tarefas com agilidade.</p></div><span class="badge-category">${state.articles.length} resultado(s)</span></div><div class="panel-card mb-4"><form id="article-filter" class="row g-2 align-items-center"><div class="col-md"><div class="input-group"><span class="input-group-text bg-white"><i class="bi bi-search"></i></span><input class="form-control" id="article-search" value="${escapeHtml(state.search)}" placeholder="Buscar por título, resumo ou conteúdo" /></div></div><div class="col-md-auto"><select class="form-select" id="category-filter"><option value="">Todas as categorias</option>${state.categories.map((category) => `<option value="${category.id}" ${category.id === state.selectedCategory ? "selected" : ""}>${escapeHtml(categoryPath(category))}</option>`).join("")}</select></div><div class="col-md-auto"><button class="btn btn-primary" type="submit">Buscar</button></div></form></div><div class="row g-3" id="article-list">${state.articles.length ? state.articles.map(articleCard).join("") : `<div class="col-12"><div class="panel-card empty-state"><i class="bi bi-search"></i><h3>Nenhum conteúdo encontrado</h3><p>Tente outra palavra-chave ou escolha uma categoria diferente.</p></div></div>`}</div>`;
      document
        .getElementById("article-filter")
        .addEventListener("submit", (event) => {
          event.preventDefault();
          state.search = document.getElementById("article-search").value.trim();
          state.selectedCategory =
            document.getElementById("category-filter").value;
          showArticles();
        });
      document
        .querySelectorAll("[data-article]")
        .forEach((element) =>
          element.addEventListener("click", () =>
            showArticle(element.dataset.article),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  async function showArticle(id) {
    if (state.user?.role !== "PLATFORM_ADMIN") return showClientArticle(id);
    const main = document.getElementById("main-view");
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Abrindo procedimento...</div>`;
    try {
      if (!state.categories.length) await loadCategories();
      const article = await api(`/articles/${id}`);
      const videoUrl = youtubeEmbedUrl(article.videoUrl);
      main.innerHTML = `<button class="btn btn-sm btn-soft mb-4" id="back-to-articles">Voltar para artigos</button><article class="article-detail"><span class="badge-category">${escapeHtml(categoryPath(article.category))}</span><h1>${escapeHtml(article.title)}</h1>${article.summary ? `<p class="lead">${escapeHtml(article.summary)}</p>` : ""}<div class="article-meta text-muted small d-flex flex-wrap gap-3"><span>Atualizado em ${formatDate(article.updatedAt)}</span><span>${escapeHtml(article.author?.name || "BlueCat Systems")}</span></div>${videoUrl ? `<div class="article-video"><iframe src="${videoUrl}" title="Vídeo do curso: ${escapeHtml(article.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>` : ""}<hr class="my-4" /><div class="article-body">${formatContent(article.content)}</div></article>`;
      document
        .getElementById("back-to-articles")
        .addEventListener("click", showArticles);
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  // Markdown simples controlado: transforma apenas os padrões suportados pelo MVP.
  function formatContent(content) {
    let html = escapeHtml(content || "");
    html = html
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>");
    html = html
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html
      .replace(/^(\d+\. .+)$/gm, "<li>$1</li>")
      .replace(/^(?:- |• )(.*)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
    return html
      .split(/\n{2,}/)
      .map((block) =>
        block.trim().startsWith("<h") || block.trim().startsWith("<ul")
          ? block
          : `<p>${block.replaceAll("\n", "<br />")}</p>`,
      )
      .join("");
  }

  // ========================= Gestão administrativa =========================
  async function showAdminArticles() {
    if (state.user?.role !== "PLATFORM_ADMIN") return showHome();
    const main = document.getElementById("main-view");
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Carregando gestão de artigos...</div>`;
    try {
      if (!state.categories.length) await loadCategories();
      const articles = await api("/articles");
      main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4"><div><span class="eyebrow">Administração</span><h1 class="page-title">Gerenciar artigos</h1><p class="page-lead mb-0">Publique e mantenha a base de conhecimento sempre atualizada.</p></div><button class="btn btn-primary" id="new-article"><i class="bi bi-plus-lg me-1"></i>Novo artigo</button></div><div class="panel-card"><div class="table-responsive"><table class="table"><thead><tr><th>Conteúdo</th><th>Categoria</th><th>Status</th><th>Atualizado</th><th class="text-end">Ações</th></tr></thead><tbody>${articles.length ? articles.map((article) => `<tr><td><div class="entity-name">${escapeHtml(article.title)}</div><div class="entity-detail">${escapeHtml(article.slug)}</div></td><td>${escapeHtml(categoryPath(article.category))}</td><td>${articleStatus(article.status)}</td><td>${formatDate(article.updatedAt)}</td><td class="text-end"><button class="btn btn-sm btn-soft me-1" data-edit-article="${article.id}" title="Editar"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-secondary" data-archive-article="${article.id}" title="Arquivar"><i class="bi bi-archive"></i></button></td></tr>`).join("") : `<tr><td colspan="5">${emptyTable("Nenhum artigo cadastrado")}</td></tr>`}</tbody></table></div></div>`;
      document
        .getElementById("new-article")
        .addEventListener("click", () => openArticleModal());
      main
        .querySelectorAll("[data-edit-article]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            openArticleModal(
              articles.find((item) => item.id === button.dataset.editArticle),
            ),
          ),
        );
      main
        .querySelectorAll("[data-archive-article]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            archiveArticle(button.dataset.archiveArticle),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  // Modal compartilhado para criar e editar artigos.
  function openArticleModal(article = null) {
    const isEdit = Boolean(article);
    openModal(
      isEdit ? "Editar artigo" : "Novo artigo",
      `<form id="article-form"><div class="row g-3"><div class="col-md-8"><label class="form-label">Título</label><input class="form-control" name="title" required minlength="3" maxlength="180" value="${escapeHtml(article?.title)}" /></div><div class="col-md-4"><label class="form-label">Status</label><select class="form-select" name="status"><option value="DRAFT" ${article?.status === "DRAFT" || !article ? "selected" : ""}>Rascunho</option><option value="PUBLISHED" ${article?.status === "PUBLISHED" ? "selected" : ""}>Publicado</option><option value="ARCHIVED" ${article?.status === "ARCHIVED" ? "selected" : ""}>Arquivado</option></select></div><div class="col-md-6"><label class="form-label">Slug <span class="fw-normal text-muted">(opcional)</span></label><input class="form-control" name="slug" maxlength="180" value="${escapeHtml(article?.slug)}" placeholder="gerado-a-partir-do-titulo" /></div><div class="col-md-6"><label class="form-label">Categoria</label><select class="form-select" name="categoryId" required>${state.categories.map((category) => `<option value="${category.id}" ${article?.categoryId === category.id || article?.category?.id === category.id ? "selected" : ""}>${escapeHtml(categoryPath(category))}</option>`).join("")}</select></div><div class="col-12"><label class="form-label">Resumo</label><input class="form-control" name="summary" maxlength="500" value="${escapeHtml(article?.summary)}" placeholder="Explique em uma frase o que o leitor encontrará" /></div><div class="col-12"><label class="form-label">Vídeo do YouTube <span class="fw-normal text-muted">(opcional)</span></label><input class="form-control" name="videoUrl" type="url" maxlength="500" value="${escapeHtml(article?.videoUrl)}" placeholder="https://www.youtube.com/watch?v=..." /><div class="form-text">O vídeo será exibido dentro da página do curso para o cliente.</div></div><div class="col-12"><label class="form-label">Conteúdo</label><textarea class="form-control" name="content" rows="10" required placeholder="Escreva o passo a passo do artigo...">${escapeHtml(article?.content)}</textarea><div class="form-text">Você pode usar Markdown simples: # títulos, **negrito**, listas e código.</div></div></div></form>`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button type="submit" form="article-form" class="btn btn-primary">${isEdit ? "Salvar alterações" : "Criar artigo"}</button>`,
    );
    document
      .getElementById("article-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        const body = Object.fromEntries(form.entries());
        try {
          await api(
            isEdit ? `/articles/${article.id}` : "/articles",
            jsonOptions(isEdit ? "PATCH" : "POST", body),
          );
          closeModal();
          toast(isEdit ? "Artigo atualizado." : "Artigo criado.");
          showAdminArticles();
        } catch (error) {
          toast(error.message, "danger");
        }
      });
  }

  async function archiveArticle(id) {
    if (
      !window.confirm(
        "Arquivar este artigo? Ele deixará de aparecer para os clientes.",
      )
    )
      return;
    try {
      await api(`/articles/${id}`, { method: "DELETE" });
      toast("Artigo arquivado.");
      showAdminArticles();
    } catch (error) {
      toast(error.message, "danger");
    }
  }

  async function showCategoriesAdmin() {
    if (state.user?.role !== "PLATFORM_ADMIN") return showHome();
    const main = document.getElementById("main-view");
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Carregando categorias...</div>`;
    try {
      const categories = await api("/categories");
      state.categories = categories;
      main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4"><div><span class="eyebrow">Administração</span><h1 class="page-title">Categorias e acessos</h1><p class="page-lead mb-0">Organize os artigos e defina quais pastas cada empresa cliente poderá consultar.</p></div><button class="btn btn-primary" id="new-category"><i class="bi bi-plus-lg me-1"></i>Nova categoria</button></div><div class="panel-card"><div class="table-responsive"><table class="table"><thead><tr><th>Categoria</th><th>Hierarquia</th><th>Artigos</th><th>Status</th><th class="text-end">Ações</th></tr></thead><tbody>${categories.length ? categories.map((category) => `<tr><td><div class="entity-name">${escapeHtml(category.name)}</div><div class="entity-detail">${escapeHtml(category.slug)}</div></td><td>${category.parent?.name ? `<span class="badge-category"><i class="bi bi-arrow-return-right me-1"></i>${escapeHtml(category.parent.name)}</span>` : "Categoria raiz"}</td><td>${category._count?.articles ?? 0}</td><td>${category.active ? `<span class="status-badge status-published">Ativa</span>` : `<span class="status-badge status-archived">Inativa</span>`}</td><td class="text-end"><button class="btn btn-sm btn-soft me-1" data-edit-category="${category.id}"><i class="bi bi-pencil"></i></button>${category.active ? `<button class="btn btn-sm btn-outline-secondary" data-deactivate-category="${category.id}"><i class="bi bi-eye-slash"></i></button>` : ""}</td></tr>`).join("") : `<tr><td colspan="5">${emptyTable("Nenhuma categoria cadastrada")}</td></tr>`}</tbody></table></div></div>`;
      document
        .getElementById("new-category")
        .addEventListener("click", () => openCategoryModal());
      main
        .querySelectorAll("[data-edit-category]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            openCategoryModal(
              categories.find(
                (item) => item.id === button.dataset.editCategory,
              ),
            ),
          ),
        );
      main
        .querySelectorAll("[data-deactivate-category]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            deactivateCategory(button.dataset.deactivateCategory),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  function openCategoryModal(category = null) {
    const isEdit = Boolean(category);
    const parents = state.categories.filter(
      (item) => item.id !== category?.id && item.active,
    );
    openModal(
      isEdit ? "Editar categoria" : "Nova categoria",
      `<form id="category-form"><div class="row g-3"><div class="col-md-7"><label class="form-label">Nome</label><input class="form-control" name="name" required minlength="2" maxlength="120" value="${escapeHtml(category?.name)}" /></div><div class="col-md-5"><label class="form-label">Slug</label><input class="form-control" name="slug" required minlength="2" maxlength="140" value="${escapeHtml(category?.slug)}" placeholder="ex: cadastro-produtos" /></div><div class="col-12"><label class="form-label">Categoria pai <span class="fw-normal text-muted">(opcional)</span></label><select class="form-select" name="parentId"><option value="">Nenhuma, categoria raiz</option>${parents.map((item) => `<option value="${item.id}" ${category?.parentId === item.id ? "selected" : ""}>${escapeHtml(categoryPath(item))}</option>`).join("")}</select></div><div class="col-md-8"><label class="form-label">Descrição</label><input class="form-control" name="description" maxlength="500" value="${escapeHtml(category?.description)}" /></div><div class="col-md-4"><label class="form-label">Ordem</label><input class="form-control" name="sortOrder" type="number" min="0" value="${category?.sortOrder ?? 0}" /></div>${isEdit ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" ${category.active ? "checked" : ""} /><label class="form-check-label">Categoria ativa</label></div></div>` : ""}</div></form>`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button type="submit" form="category-form" class="btn btn-primary">${isEdit ? "Salvar alterações" : "Criar categoria"}</button>`,
    );
    document
      .getElementById("category-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const body = Object.fromEntries(data.entries());
        body.sortOrder = Number(body.sortOrder || 0);
        if (isEdit) body.active = data.get("active") === "on";
        if (!body.parentId) delete body.parentId;
        try {
          await api(
            isEdit ? `/categories/${category.id}` : "/categories",
            jsonOptions(isEdit ? "PATCH" : "POST", body),
          );
          closeModal();
          toast(isEdit ? "Categoria atualizada." : "Categoria criada.");
          showCategoriesAdmin();
        } catch (error) {
          toast(error.message, "danger");
        }
      });
  }

  async function deactivateCategory(id) {
    if (!window.confirm("Desativar esta categoria?")) return;
    try {
      await api(`/categories/${id}`, { method: "DELETE" });
      toast("Categoria desativada.");
      showCategoriesAdmin();
    } catch (error) {
      toast(error.message, "danger");
    }
  }

  async function showCompaniesAdmin() {
    if (state.user?.role !== "PLATFORM_ADMIN") return showHome();
    const main = document.getElementById("main-view");
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Carregando empresas...</div>`;
    try {
      state.companies = await api("/companies");
      main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4"><div><span class="eyebrow">Administração</span><h1 class="page-title">Empresas clientes</h1><p class="page-lead mb-0">Gerencie organizações, usuários e o recorte de conteúdos liberado.</p></div><button class="btn btn-primary" id="new-company"><i class="bi bi-plus-lg me-1"></i>Nova empresa</button></div><div class="row g-3">${state.companies.length ? state.companies.map((company) => `<div class="col-12 col-md-6 col-xl-4"><div class="panel-card h-100"><div class="d-flex justify-content-between align-items-start"><div class="category-icon"><i class="bi bi-building"></i></div>${company.active ? `<span class="status-badge status-published">Ativa</span>` : `<span class="status-badge status-archived">Inativa</span>`}</div><h3 class="h6 fw-bold mt-3 mb-1">${escapeHtml(company.name)}</h3><p class="text-muted small mb-3">${escapeHtml(company.document || "Documento não informado")}</p><div class="d-flex gap-3 text-muted small mb-3"><span><i class="bi bi-people me-1"></i>${company._count?.users ?? 0} usuários</span><span><i class="bi bi-grid me-1"></i>${company._count?.categoryPermissions ?? 0} categorias</span></div><button class="btn btn-sm btn-soft w-100" data-manage-company="${company.id}">Gerenciar empresa <i class="bi bi-arrow-right ms-1"></i></button></div></div>`).join("") : `<div class="col-12"><div class="panel-card empty-state"><i class="bi bi-buildings"></i><h3>Nenhuma empresa cadastrada</h3><p>Crie a primeira empresa para começar.</p></div></div>`}</div>`;
      document
        .getElementById("new-company")
        .addEventListener("click", () => openCompanyModal());
      main
        .querySelectorAll("[data-manage-company]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            openCompanyModal(
              state.companies.find(
                (item) => item.id === button.dataset.manageCompany,
              ),
            ),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  function openCompanyModal(company = null) {
    const isEdit = Boolean(company);
    openModal(
      isEdit ? "Gerenciar empresa" : "Nova empresa",
      `<form id="company-form"><div class="row g-3"><div class="col-md-8"><label class="form-label">Nome da empresa</label><input class="form-control" name="name" required minlength="2" maxlength="160" value="${escapeHtml(company?.name)}" /></div><div class="col-md-4"><label class="form-label">CNPJ / documento</label><input class="form-control" name="document" maxlength="30" value="${escapeHtml(company?.document)}" /></div>${isEdit ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" ${company.active ? "checked" : ""} /><label class="form-check-label">Empresa ativa</label></div></div>` : ""}</div></form>${isEdit ? `<hr class="my-4" /><div class="d-flex align-items-center justify-content-between mb-2"><div><h3 class="h6 fw-bold mb-1">Categorias liberadas</h3><p class="text-muted small mb-0">Defina quais áreas este cliente poderá consultar.</p></div><span class="spinner-border spinner-border-sm d-none" id="permissions-loading"></span></div><div id="company-permissions" class="row g-2"><div class="small text-muted">Carregando permissões...</div></div>` : ""}`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>${isEdit ? `<button type="button" class="btn btn-soft" id="save-permissions"><i class="bi bi-check2 me-1"></i>Salvar permissões</button>` : ""}<button type="submit" form="company-form" class="btn btn-primary">${isEdit ? "Salvar empresa" : "Criar empresa"}</button>`,
    );
    document
      .getElementById("company-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const body = Object.fromEntries(data.entries());
        if (isEdit) body.active = data.get("active") === "on";
        try {
          await api(
            isEdit ? `/companies/${company.id}` : "/companies",
            jsonOptions(isEdit ? "PATCH" : "POST", body),
          );
          closeModal();
          toast(isEdit ? "Empresa atualizada." : "Empresa criada.");
          showCompaniesAdmin();
        } catch (error) {
          toast(error.message, "danger");
        }
      });
    if (isEdit) loadCompanyPermissions(company.id);
    document
      .getElementById("save-permissions")
      ?.addEventListener("click", async () => {
        const categoryIds = [
          ...document.querySelectorAll("#company-permissions input:checked"),
        ].map((input) => input.value);
        const button = document.getElementById("save-permissions");
        button.disabled = true;
        try {
          await api(
            `/companies/${company.id}/category-permissions`,
            jsonOptions("PUT", { categoryIds }),
          );
          toast("Permissões salvas.");
        } catch (error) {
          toast(error.message, "danger");
        } finally {
          button.disabled = false;
        }
      });
  }

  async function loadCompanyPermissions(companyId) {
    const target = document.getElementById("company-permissions");
    if (!target) return;
    try {
      const permissions = await api(
        `/companies/${companyId}/category-permissions`,
      );
      const enabled = new Set(permissions.map((item) => item.categoryId));
      target.innerHTML =
        state.categories
          .map(
            (category) =>
              `<div class="col-12 col-md-6"><label class="border rounded-3 p-2 d-flex align-items-center gap-2 small"><input class="form-check-input mt-0" type="checkbox" value="${category.id}" ${enabled.has(category.id) ? "checked" : ""} /><span>${escapeHtml(categoryPath(category))}</span></label></div>`,
          )
          .join("") ||
        `<div class="small text-muted">Cadastre categorias antes de liberar o acesso.</div>`;
    } catch (error) {
      target.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
    }
  }

  function accessRequestStatus(status) {
    const labels = {
      PENDING: "Pendente",
      APPROVED: "Aprovada",
      REJECTED: "Recusada",
    };
    const classes = {
      PENDING: "status-draft",
      APPROVED: "status-published",
      REJECTED: "status-archived",
    };
    return `<span class="status-badge ${classes[status] || "status-archived"}">${labels[status] || status}</span>`;
  }

  // Fila de solicitações: só o admin escolhe empresa/perfil e libera o acesso.
  async function showAccessRequestsAdmin() {
    if (state.user?.role !== "PLATFORM_ADMIN") return showHome();
    setActiveNav("access-requests");
    state.activeView = "access-requests";
    const main = document.getElementById("main-view");
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Carregando solicitações...</div>`;
    try {
      const [requests, companies] = await Promise.all([
        api("/access-requests"),
        state.companies.length
          ? Promise.resolve(state.companies)
          : api("/companies"),
      ]);
      state.companies = companies;
      const order = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
      requests.sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          new Date(b.createdAt) - new Date(a.createdAt),
      );
      const pendingCount = requests.filter(
        (request) => request.status === "PENDING",
      ).length;
      main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4"><div><span class="eyebrow">Administração</span><h1 class="page-title">Solicitações de acesso</h1><p class="page-lead mb-0">Revise os pedidos recebidos e libere o acesso somente depois de confirmar a empresa.</p></div><span class="badge-category">${pendingCount} pendente(s)</span></div><div class="panel-card"><div class="table-responsive"><table class="table access-requests-table"><thead><tr><th>Solicitante</th><th>Empresa informada</th><th>Mensagem</th><th>Status</th><th>Recebida em</th><th class="text-end">Ações</th></tr></thead><tbody>${requests.length ? requests.map((request) => `<tr><td><div class="entity-name">${escapeHtml(request.name)}</div><div class="entity-detail">${escapeHtml(request.email)}</div></td><td><div class="entity-name">${escapeHtml(request.companyName)}</div><div class="entity-detail">${escapeHtml(request.companyDocument || "Documento não informado")}</div></td><td><span class="request-message">${escapeHtml(request.message || "Nenhuma mensagem")}</span></td><td>${accessRequestStatus(request.status)}</td><td>${formatDate(request.createdAt)}</td><td class="text-end">${request.status === "PENDING" ? `<button class="btn btn-sm btn-primary me-1" data-approve-request="${request.id}"><i class="bi bi-check2 me-1"></i>Liberar</button><button class="btn btn-sm btn-outline-secondary" data-reject-request="${request.id}">Recusar</button>` : "—"}</td></tr>`).join("") : `<tr><td colspan="6">${emptyTable("Nenhuma solicitação recebida")}</td></tr>`}</tbody></table></div></div>`;
      main
        .querySelectorAll("[data-approve-request]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            openApproveAccessRequestModal(
              requests.find(
                (request) => request.id === button.dataset.approveRequest,
              ),
            ),
          ),
        );
      main
        .querySelectorAll("[data-reject-request]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            openRejectAccessRequestModal(
              requests.find(
                (request) => request.id === button.dataset.rejectRequest,
              ),
            ),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  async function openApproveAccessRequestModal(request) {
    if (!request) return;
    const companies = state.companies.filter((company) => company.active);
    if (!companies.length) {
      toast("Cadastre uma empresa ativa antes de liberar um acesso.", "danger");
      return;
    }
    openModal(
      "Liberar acesso",
      `<p class="text-muted small">Confirme a empresa e o perfil que serão vinculados a <strong>${escapeHtml(request.name)}</strong>.</p><div id="approve-request-alert"></div><form id="approve-request-form"><div class="mb-3"><label class="form-label">Empresa</label><select class="form-select" name="companyId" required>${companies.map((company) => `<option value="${company.id}" ${company.name.toLowerCase() === request.companyName.toLowerCase() ? "selected" : ""}>${escapeHtml(company.name)}</option>`).join("")}</select></div><div><label class="form-label">Perfil</label><select class="form-select" name="role"><option value="CLIENT_VIEWER">Leitor</option><option value="CLIENT_EDITOR">Editor do cliente</option><option value="CLIENT_ADMIN">Administrador do cliente</option></select></div></form>`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button type="submit" form="approve-request-form" class="btn btn-primary" id="approve-request-submit">Liberar acesso</button>`,
    );
    document
      .getElementById("approve-request-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = document.getElementById("approve-request-submit");
        const alert = document.getElementById("approve-request-alert");
        const body = Object.fromEntries(new FormData(event.target).entries());
        submit.disabled = true;
        submit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Liberando...`;
        try {
          const result = await api(
            `/access-requests/${request.id}/approve`,
            jsonOptions("POST", body),
          );
          closeModal();
          showApprovedAccessCredentials(result);
          await showAccessRequestsAdmin();
        } catch (error) {
          alert.innerHTML = `<div class="alert alert-danger py-2">${escapeHtml(error.message)}</div>`;
          submit.disabled = false;
          submit.textContent = "Liberar acesso";
        }
      });
  }

  function showApprovedAccessCredentials(result) {
    openModal(
      "Acesso liberado",
      `<p class="text-muted small">O usuário foi criado. Copie estes dados e envie ao cliente por um canal seguro. A senha não ficará disponível novamente nesta tela.</p><div class="credential-summary"><div><span>E-mail</span><code>${escapeHtml(result.user.email)}</code></div><div><span>Senha temporária</span><code>${escapeHtml(result.temporaryPassword)}</code></div></div><div class="alert alert-warning py-2 mt-3 mb-0 small">No primeiro acesso, o cliente será obrigado a trocar a senha temporária.</div>`,
      `<button type="button" class="btn btn-primary" data-bs-dismiss="modal">Concluir</button>`,
    );
  }

  function openRejectAccessRequestModal(request) {
    if (!request) return;
    openModal(
      "Recusar solicitação",
      `<p class="text-muted small">A solicitação de <strong>${escapeHtml(request.name)}</strong> será marcada como recusada. O motivo é opcional.</p><form id="reject-request-form"><label class="form-label" for="reject-reason">Motivo</label><textarea class="form-control" id="reject-reason" name="reason" maxlength="500" rows="3" placeholder="Ex.: não foi possível confirmar o vínculo com a empresa."></textarea></form>`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button type="submit" form="reject-request-form" class="btn btn-primary" id="reject-request-submit">Recusar solicitação</button>`,
    );
    document
      .getElementById("reject-request-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = document.getElementById("reject-request-submit");
        const body = Object.fromEntries(new FormData(event.target).entries());
        submit.disabled = true;
        try {
          await api(
            `/access-requests/${request.id}/reject`,
            jsonOptions("POST", body),
          );
          closeModal();
          toast("Solicitação recusada.");
          showAccessRequestsAdmin();
        } catch (error) {
          toast(error.message, "danger");
          submit.disabled = false;
        }
      });
  }

  // Usuários criados diretamente pelo admin, além dos aprovados pela fila.
  async function showUsersAdmin() {
    if (state.user?.role !== "PLATFORM_ADMIN") return showHome();
    const main = document.getElementById("main-view");
    main.innerHTML = `<div class="loading-state"><span class="spinner-border spinner-border-sm me-2"></span>Carregando usuários...</div>`;
    try {
      if (!state.companies.length) state.companies = await api("/companies");
      const defaultCompany = state.companies[0]?.id;
      const companyId =
        new URLSearchParams(window.location.search).get("companyId") ||
        defaultCompany ||
        "";
      const users = companyId ? await api(`/companies/${companyId}/users`) : [];
      main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4"><div><span class="eyebrow">Administração</span><h1 class="page-title">Usuários</h1><p class="page-lead mb-0">Controle quem pode acessar o Portal de Conhecimento.</p></div><div class="d-flex gap-2">${state.user.role === "PLATFORM_ADMIN" ? `<select class="form-select" id="users-company" style="min-width:220px">${state.companies.map((company) => `<option value="${company.id}" ${company.id === companyId ? "selected" : ""}>${escapeHtml(company.name)}</option>`).join("")}</select>` : ""}<button class="btn btn-primary" id="new-user" ${companyId ? "" : "disabled"}><i class="bi bi-plus-lg me-1"></i>Novo usuário</button></div></div><div class="panel-card"><div class="table-responsive"><table class="table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Cadastro</th><th class="text-end">Ações</th></tr></thead><tbody>${users.length ? users.map((user) => `<tr><td><div class="entity-name">${escapeHtml(user.name)}</div><div class="entity-detail">${escapeHtml(user.email)}</div></td><td>${escapeHtml(roleLabel(user.role))}</td><td>${user.active ? `<span class="status-badge status-published">Ativo</span>` : `<span class="status-badge status-archived">Inativo</span>`}</td><td>${formatDate(user.createdAt)}</td><td class="text-end"><button class="btn btn-sm btn-soft me-1" data-edit-user="${user.id}"><i class="bi bi-pencil"></i></button>${state.user.role === "PLATFORM_ADMIN" && user.active ? `<button class="btn btn-sm btn-outline-secondary" data-deactivate-user="${user.id}"><i class="bi bi-person-slash"></i></button>` : ""}</td></tr>`).join("") : `<tr><td colspan="5">${emptyTable(companyId ? "Nenhum usuário cadastrado nesta empresa" : "Selecione uma empresa")}</td></tr>`}</tbody></table></div></div>`;
      document
        .getElementById("users-company")
        ?.addEventListener("change", (event) => {
          const url = new URL(window.location.href);
          url.searchParams.set("companyId", event.target.value);
          history.replaceState({}, "", url);
          showUsersAdmin();
        });
      document
        .getElementById("new-user")
        ?.addEventListener("click", () => openUserModal(companyId));
      main.querySelectorAll("[data-edit-user]").forEach((button) =>
        button.addEventListener("click", () =>
          openUserModal(
            companyId,
            users.find((item) => item.id === button.dataset.editUser),
          ),
        ),
      );
      main
        .querySelectorAll("[data-deactivate-user]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            deactivateUser(button.dataset.deactivateUser),
          ),
        );
    } catch (error) {
      main.innerHTML = errorState(error.message);
    }
  }

  function openUserModal(companyId, user = null) {
    const isEdit = Boolean(user);
    const roles =
      state.user.role === "PLATFORM_ADMIN"
        ? ["CLIENT_ADMIN", "CLIENT_EDITOR", "CLIENT_VIEWER"]
        : [];
    openModal(
      isEdit ? "Editar usuário" : "Novo usuário",
      `<form id="user-form"><div class="row g-3"><div class="col-md-6"><label class="form-label">Nome</label><input class="form-control" name="name" required minlength="2" maxlength="120" value="${escapeHtml(user?.name)}" /></div><div class="col-md-6"><label class="form-label">E-mail</label><input class="form-control" type="email" name="email" ${isEdit ? "disabled" : "required"} value="${escapeHtml(user?.email)}" /></div>${!isEdit ? `<div class="col-md-6"><label class="form-label">Perfil</label><select class="form-select" name="role">${roles.map((role) => `<option value="${role}">${escapeHtml(roleLabel(role))}</option>`).join("")}</select></div><div class="col-md-6"><label class="form-label">Senha temporária <span class="fw-normal text-muted">(opcional)</span></label><input class="form-control" name="temporaryPassword" minlength="8" maxlength="120" placeholder="Gerada automaticamente" /></div>` : `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" ${user.active ? "checked" : ""} /><label class="form-check-label">Usuário ativo</label></div></div><div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" name="resetTemporaryPassword" id="reset-password" /><label class="form-check-label" for="reset-password">Gerar nova senha temporária</label></div></div><div class="col-12 d-none" id="temporary-password-wrap"><label class="form-label">Definir senha temporária <span class="fw-normal text-muted">(opcional)</span></label><input class="form-control" name="temporaryPassword" minlength="8" maxlength="120" /></div>`}</div></form>`,
      `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button type="submit" form="user-form" class="btn btn-primary">Salvar usuário</button>`,
    );
    document
      .getElementById("reset-password")
      ?.addEventListener("change", (event) =>
        document
          .getElementById("temporary-password-wrap")
          .classList.toggle("d-none", !event.target.checked),
      );
    document
      .getElementById("user-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const body = Object.fromEntries(data.entries());
        if (isEdit) {
          body.active = data.get("active") === "on";
          body.resetTemporaryPassword =
            data.get("resetTemporaryPassword") === "on";
        }
        try {
          const result = await api(
            isEdit ? `/users/${user.id}` : `/companies/${companyId}/users`,
            jsonOptions(isEdit ? "PATCH" : "POST", body),
          );
          closeModal();
          toast(
            isEdit && result.temporaryPassword
              ? `Usuário salvo. Senha temporária: ${result.temporaryPassword}`
              : isEdit
                ? "Usuário atualizado."
                : `Usuário criado. Senha temporária: ${result.temporaryPassword}`,
          );
          showUsersAdmin();
        } catch (error) {
          toast(error.message, "danger");
        }
      });
  }

  async function deactivateUser(id) {
    if (!window.confirm("Desativar este usuário?")) return;
    try {
      await api(`/users/${id}`, { method: "DELETE" });
      toast("Usuário desativado.");
      showUsersAdmin();
    } catch (error) {
      toast(error.message, "danger");
    }
  }

  // Primeiro login e alteração manual passam pelo mesmo formulário de senha.
  function openPasswordModal(required) {
    openModal(
      required ? "Antes de continuar" : "Alterar senha",
      `<p class="text-muted small">${required ? "Antes de continuar, escolha uma senha que só você conheça." : "Use uma senha com pelo menos 8 caracteres."}</p><div id="password-alert"></div><form id="password-form"><div class="mb-3"><label class="form-label">Senha atual</label><input class="form-control" type="password" name="currentPassword" minlength="8" required /></div><div><label class="form-label">Nova senha</label><input class="form-control" type="password" name="newPassword" minlength="8" required /></div></form>`,
      `${required ? "" : `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>`}<button type="submit" form="password-form" class="btn btn-primary">Atualizar senha</button>`,
    );
    document
      .getElementById("password-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(event.target).entries());
        try {
          const result = await api(
            "/auth/change-password",
            jsonOptions("POST", body),
          );
          state.user = result.user;
          closeModal();
          toast("Senha alterada com sucesso.");
        } catch (error) {
          document.getElementById("password-alert").innerHTML =
            `<div class="alert alert-danger py-2">${escapeHtml(error.message)}</div>`;
        }
      });
  }

  // Todos os formulários administrativos usam o mesmo modal Bootstrap.
  function openModal(title, body, footer) {
    document.getElementById("entity-modal-content").innerHTML =
      `<div class="modal-header"><h2 class="modal-title fs-5">${title}</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div><div class="modal-body">${body}</div><div class="modal-footer">${footer}</div>`;
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("entity-modal"),
    ).show();
  }
  function closeModal() {
    bootstrap.Modal.getInstance(
      document.getElementById("entity-modal"),
    )?.hide();
  }
  function emptyTable(message) {
    return `<div class="empty-state py-4"><i class="bi bi-inbox"></i><h3>${escapeHtml(message)}</h3></div>`;
  }
  function errorState(message) {
    return `<div class="panel-card empty-state"><i class="bi bi-exclamation-circle"></i><h3>Não foi possível carregar esta página</h3><p>${escapeHtml(message)}</p><button class="btn btn-primary mt-2" data-retry-page="true">Tentar novamente</button></div>`;
  }

  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-retry-page]")
        : null;
    if (target) window.location.reload();
  });

  // Ao recarregar a página, o SDK renova a sessão e /auth/me revalida o perfil.
  async function restoreSession() {
    renderLogin();
    if (!isConfigured) return;
    try {
      if (hasSupabaseConfig) {
        const { data } = await supabaseClient.auth.getSession();
        if (!data.session) return;
      }
      state.user = await api("/auth/me");
      renderPortal();
      await showHome();
    } catch {
      state.user = null;
    }
  }

  void restoreSession();
})();
