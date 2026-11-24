(function () {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");

  function setTheme(dark) {
    root.classList.toggle("dark", dark);
    if (toggle) {
      toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      toggle.dataset.theme = dark ? "dark" : "light";
    }
  }

  if (toggle) {
    setTheme(root.classList.contains("dark"));
    toggle.addEventListener("click", () => {
      const next = !root.classList.contains("dark");
      localStorage.setItem("ogrl-tools-theme", next ? "dark" : "light");
      setTheme(next);
    });
  }

  // GitHub star count: paint last-known value instantly, then refresh on every load.
  // GitHub sends max-age=60, so the browser HTTP cache keeps us well under the 60 req/h anon limit.
  const ghBtn = document.querySelector("[data-gh-repo]");
  if (ghBtn) {
    const repo = ghBtn.dataset.ghRepo;
    const starsEl = ghBtn.querySelector(".gh-stars");
    const countEl = ghBtn.querySelector(".gh-star-count");
    const cacheKey = `ogrl-tools-gh-stars:${repo}`;
    const fmt = (n) =>
      n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
    const show = (n) => {
      countEl.textContent = fmt(n);
      starsEl.hidden = false;
      ghBtn.setAttribute("aria-label", `ogrl-tooling on GitHub, ${n} stars`);
    };
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
    } catch (e) {}
    if (cached && typeof cached.n === "number") show(cached.n);
    fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || typeof d.stargazers_count !== "number") return;
        show(d.stargazers_count);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ n: d.stargazers_count, t: Date.now() }));
        } catch (e) {}
      })
      .catch(() => {});
  }

  // Copy buttons on code blocks
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pre = btn.closest(".code-block")?.querySelector("pre");
      if (!pre) return;
      try {
        await navigator.clipboard.writeText(pre.textContent || "");
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1500);
      } catch {
        btn.textContent = "Failed";
      }
    });
  });

  // Active section highlight in sticky TOC
  const tocLinks = Array.from(document.querySelectorAll(".doc-toc a[href^='#']"));
  if (tocLinks.length > 0) {
    const targets = tocLinks
      .map((a) => ({ a, el: document.getElementById(a.getAttribute("href").slice(1)) }))
      .filter((item) => item.el);

    function updateActive() {
      const offset = 110;
      let current = targets[0];
      for (const item of targets) {
        if (item.el.getBoundingClientRect().top <= offset) {
          current = item;
        } else {
          break;
        }
      }
      tocLinks.forEach((a) => a.classList.toggle("is-active", current && a === current.a));
    }

    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(() => {
            updateActive();
            ticking = false;
          });
        }
      },
      { passive: true },
    );
    updateActive();
  }

})();
