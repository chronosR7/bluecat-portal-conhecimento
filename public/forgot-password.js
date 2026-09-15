(() => {
  "use strict";

  const config = window.BLUECAT_CONFIG || {};
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(config.SUPABASE_ANON_KEY || "");
  const alertBox = document.getElementById("forgot-alert");
  const submit = document.getElementById("forgot-submit");
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const showError = (message) => {
    alertBox.innerHTML = `<div class="alert alert-danger py-2">${escapeHtml(message)}</div>`;
  };
  const client = window.supabase && url && key
    ? window.supabase.createClient(url, key)
    : null;

  document.getElementById("forgot-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("forgot-email").value.trim().toLowerCase();
    if (!client || !email) return;
    submit.disabled = true;
    submit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Enviando...`;
    const redirectTo = new URL("./reset-password.html", document.baseURI).href;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      const limited = /rate limit|too many|email rate/i.test(error.message);
      showError(limited
        ? "O limite de envio de e-mails foi atingido. Aguarde e tente novamente mais tarde, sem repetir o pedido."
        : error.message);
      submit.disabled = false;
      submit.innerHTML = `Enviar link de recuperação <i class="bi bi-arrow-right ms-2"></i>`;
      return;
    }
    alertBox.innerHTML = `<div class="alert alert-success py-2">Se este e-mail estiver cadastrado, o link foi enviado. Verifique também a caixa de spam.</div>`;
    submit.disabled = true;
    submit.textContent = "Link solicitado";
  });
})();
