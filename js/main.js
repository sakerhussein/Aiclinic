/* Limitsiz Clinic: demo/contact form (saves leads to Supabase) */
(function () {
  "use strict";

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var client = null;

  function getClient() {
    if (client) return client;
    var cfg = window.LC_CONFIG || {};
    var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 &&
                     cfg.SUPABASE_PUBLISHABLE_KEY && cfg.SUPABASE_PUBLISHABLE_KEY.indexOf("YOUR_") === -1;
    if (!configured || !window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false }
    });
    return client;
  }

  function setStatus(message, kind) {
    var el = document.getElementById("formStatus");
    if (!el) return;
    el.textContent = message;
    el.className = "form-status" + (kind ? " " + kind : "");
  }

  function clean(value, max) {
    return String(value || "").trim().slice(0, max);
  }

  // "What should we fix first?" chips: one selected at a time.
  function selectedTopic() {
    var on = document.querySelector('#topicChips .chip[aria-pressed="true"]');
    return on ? on.getAttribute("data-topic") : "";
  }

  function initChips() {
    var wrap = document.getElementById("topicChips");
    if (!wrap) return;
    wrap.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      wrap.querySelectorAll(".chip").forEach(function (c) {
        c.setAttribute("aria-pressed", c === chip ? "true" : "false");
      });
    });
  }

  function setButtonLabel(button, text) {
    var label = button.querySelector("[data-i18n]") || button;
    label.textContent = text;
  }

  function handleSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = document.getElementById("formSubmit");
    var lang = document.documentElement.lang || "en";
    var t = window.t;

    // Honeypot: real visitors leave this empty.
    if (form.website && form.website.value) {
      form.reset();
      setStatus(t("form_spam", lang), "ok");
      return;
    }

    var name = clean(form.name.value, 200);
    var email = clean(form.email.value, 320);
    if (!name || !EMAIL_RE.test(email)) {
      setStatus(t("form_invalid", lang), "err");
      return;
    }

    // The leads table has no topic column yet, so the chosen topic leads the message.
    var topic = selectedTopic();
    var message = clean(form.message.value, 1900);
    if (topic) message = "[Focus: " + topic + "] " + message;

    var row = {
      name: name,
      clinic: clean(form.clinic.value, 200) || null,
      email: email,
      phone: clean(form.phone.value, 40) || null,
      message: clean(message, 2000) || null,
      language: lang,
      source: "website",
      page: location.pathname.split("/").pop() || "index.html"
    };

    var supa = getClient();
    if (!supa) {
      setStatus(t("form_not_configured", lang), "err");
      return;
    }

    button.disabled = true;
    setButtonLabel(button, t("form_sending", lang));
    setStatus("", "");

    supa.from((window.LC_CONFIG && window.LC_CONFIG.LEADS_TABLE) || "leads")
      .insert(row)
      .then(function (res) {
        if (res.error) throw res.error;
        form.reset();
        setStatus(t("form_success", lang), "ok");
      })
      .catch(function () {
        setStatus(t("form_error", lang), "err");
      })
      .finally(function () {
        button.disabled = false;
        setButtonLabel(button, t("form_submit", lang));
      });
  }

  function init() {
    initChips();
    var form = document.getElementById("demoForm");
    if (form) form.addEventListener("submit", handleSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
