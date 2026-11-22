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
