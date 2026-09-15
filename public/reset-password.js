(() => {
  "use strict";

  const config = window.BLUECAT_CONFIG || {};
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(config.SUPABASE_ANON_KEY || "");
  const client = window.supabase && url && key
    ? window.supabase.createClient(url, key)
    : null;
  const alertBox = document.getElementById("reset-alert");
  const form = document.getElementById("reset-form");
  const submit = document.getElementById("reset-submit");
  const back = document.getElementById("reset-back");
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const showError = (message) => {
    alertBox.innerHTML = `<div class="alert alert-danger py-2">${escapeHtml(message)}</div>`;
    back.classList.remove("d-none");
  };
  const showForm = () => {
    alertBox.innerHTML = "";
    form.classList.remove("d-none");
  };

  const waitForRecoverySession = async () => {
    if (!client) throw new Error("Serviço de autenticação não configurado.");
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
    }
    const current = await client.auth.getSession();
    if (current.data.session) return current.data.session;
    return new Promise((resolve, reject) => {
      let finished = false;
      let subscription;
      const finishWithError = () => {
        if (finished) return;
        finished = true;
        subscription?.unsubscribe();
        reject(new Error("Este link de recuperação expirou ou já foi utilizado."));
      };
      const timeout = window.setTimeout(finishWithError, 8000);
      subscription = client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session && !finished) {
          finished = true;
          window.clearTimeout(timeout);
          subscription.unsubscribe();
          resolve(session);
        }
      }).data.subscription;
    });
  };

  (async () => {
    try {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const queryParams = new URLSearchParams(window.location.search);
      const authError = hashParams.get("error_description") || queryParams.get("error_description");
      if (authError) throw new Error(authError.replaceAll("+", " "));
      await waitForRecoverySession();
      showForm();
    } catch (error) {
      showError(error.message || "Não foi possível validar o link de recuperação.");
    }
  })();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("new-password").value;
    const confirmation = document.getElementById("confirm-password").value;
    if (password !== confirmation) {
      showError("As senhas não conferem.");
      form.classList.remove("d-none");
      return;
    }
    submit.disabled = true;
    submit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Salvando...`;
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      showError(error.message);
      submit.disabled = false;
      submit.innerHTML = `Salvar nova senha <i class="bi bi-arrow-right ms-2"></i>`;
      return;
    }
    await client.auth.signOut();
    window.history.replaceState({}, document.title, "./reset-password.html");
    form.classList.add("d-none");
    alertBox.innerHTML = `<div class="alert alert-success py-2">Senha alterada com sucesso.</div>`;
    back.classList.remove("d-none");
  });
})();
