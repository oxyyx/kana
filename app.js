"use strict";

(() => {
  const TIME_LIMIT_MS = 5000;
  const FEEDBACK_OK_MS = 600;
  const FEEDBACK_BAD_MS = 1200;
  const FOCUS_WEIGHT = 3; // "vaker"-tekens zitten zo vaak in de stapel
  const STORE_KEY = "kana:options:v2";

  // Hiragana + romaji (eerste = getoond antwoord, rest = ook goed). Katakana wordt afgeleid.
  const GROUPS = {
    basic: "あ a,い i,う u,え e,お o,か ka,き ki,く ku,け ke,こ ko,さ sa,し shi si,す su,せ se,そ so,た ta,ち chi ti,つ tsu tu,て te,と to,な na,に ni,ぬ nu,ね ne,の no,は ha,ひ hi,ふ fu hu,へ he,ほ ho,ま ma,み mi,む mu,め me,も mo,や ya,ゆ yu,よ yo,ら ra,り ri,る ru,れ re,ろ ro,わ wa,を wo o,ん n nn",
    dakuten: "が ga,ぎ gi,ぐ gu,げ ge,ご go,ざ za,じ ji zi,ず zu,ぜ ze,ぞ zo,だ da,ぢ ji di zi,づ zu du,で de,ど do,ば ba,び bi,ぶ bu,べ be,ぼ bo,ぱ pa,ぴ pi,ぷ pu,ぺ pe,ぽ po",
    combo: "きゃ kya,きゅ kyu,きょ kyo,しゃ sha sya,しゅ shu syu,しょ sho syo,ちゃ cha tya cya,ちゅ chu tyu cyu,ちょ cho tyo cyo,にゃ nya,にゅ nyu,にょ nyo,ひゃ hya,ひゅ hyu,ひょ hyo,みゃ mya,みゅ myu,みょ myo,りゃ rya,りゅ ryu,りょ ryo,ぎゃ gya,ぎゅ gyu,ぎょ gyo,じゃ ja zya jya,じゅ ju zyu jyu,じょ jo zyo jyo,びゃ bya,びゅ byu,びょ byo,ぴゃ pya,ぴゅ pyu,ぴょ pyo",
  };

  // Lettertypes: subsets met alleen kana in fonts/, zie style.css. Per kaart wordt er één gekozen.
  const FONTS = {
    kyokasho: { label: "Textbook", family: "Kana Kyokasho" },
    system: { label: "System", family: "" },
    gothic: { label: "Gothic", family: "Kana Gothic" },
    mincho: { label: "Mincho", family: "Kana Mincho" },
    maru: { label: "Rounded", family: "Kana Maru" },
    kalligrafie: { label: "Calligraphy", family: "Kana Kalligrafie" },
    handschrift: { label: "Handwriting", family: "Kana Handschrift" },
    pixel: { label: "Pixel", family: "Kana Pixel" },
  };

  const KANA = Object.fromEntries(
    Object.entries(GROUPS).map(([group, list]) => [
      group,
      list.split(",").map((entry) => {
        const [kana, ...romaji] = entry.split(" ");
        return { kana, romaji };
      }),
    ])
  );

  // Tabelweergave: basis als gojūon-raster (・ = lege cel), de rest in volgorde.
  const TABLE = {
    basic: { label: "Basic", cols: 5, layout: [..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもや・ゆ・よらりるれろわ・・・をん"] },
    dakuten: { label: "Dakuten", cols: 5, layout: KANA.dakuten.map((k) => k.kana) },
    combo: { label: "Combinations", cols: 3, layout: KANA.combo.map((k) => k.kana) },
  };
  const ROMAJI = new Map(Object.values(KANA).flat().map((k) => [k.kana, k.romaji[0]]));
  const NEXT_MARK = { on: "focus", focus: "off", off: "on" };
  let marks = {}; // hiragana → "focus" | "off"; ontbrekend = aan
  const markOf = (kana) => marks[kana] || "on";

  const toKatakana =(s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const normalize = (s) => s.trim().toLowerCase();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $("setup"), options: $("options"), total: $("total"), start: $("start"),
    game: $("game"), stop: $("stop"), score: $("score"), streak: $("streak"),
    card: $("card"), kana: $("kana"), fontLabel: $("font-label"), answer: $("answer"), timer: $("timer"),
    form: $("answer-form"), input: $("input"),
    editChars: $("edit-chars"), marksSummary: $("marks-summary"), chars: $("chars"), charTables: $("char-tables"),
  };

  // --- Opties ---

  function readOptions() {
    return {
      script: el.options.elements.script.value,
      groups: [...el.options.querySelectorAll("[name=group]:checked")].map((i) => i.value),
      fonts: [...el.options.querySelectorAll("[name=font]:checked")].map((i) => i.value),
      marks,
    };
  }

  const activeKana = (groups) => groups.flatMap((g) => KANA[g]).filter((k) => markOf(k.kana) !== "off");

  function cardCount({ script, groups }) {
    const perScript = activeKana(groups).length;
    return script === "both" ? perScript * 2 : perScript;
  }

  function marksSummary(groups) {
    const all = groups.flatMap((g) => KANA[g]);
    const focus = all.filter((k) => markOf(k.kana) === "focus").length;
    const off = all.filter((k) => markOf(k.kana) === "off").length;
    const parts = [focus && `${focus} focus`, off && `${off} off`].filter(Boolean);
    return parts.length ? parts.join(" · ") : "all on";
  }

  function onOptionsChange() {
    const opts = readOptions();
    const count = cardCount(opts);
    el.total.textContent = count;
    el.marksSummary.textContent = marksSummary(opts.groups);
    el.start.disabled = count === 0 || opts.fonts.length === 0;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(opts)); } catch {}
  }

  function restoreOptions() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch {}
    if (saved && typeof saved === "object") {
      for (const r of el.options.elements.script) r.checked = r.value === saved.script;
      if (!el.options.elements.script.value) el.options.elements.script[0].checked = true;
      if (Array.isArray(saved.groups)) {
        for (const c of el.options.querySelectorAll("[name=group]")) c.checked = saved.groups.includes(c.value);
      }
      if (Array.isArray(saved.fonts)) {
        for (const c of el.options.querySelectorAll("[name=font]")) c.checked = saved.fonts.includes(c.value);
      }
      if (saved.marks && typeof saved.marks === "object") {
        marks = Object.fromEntries(
          Object.entries(saved.marks).filter(([k, m]) => ROMAJI.has(k) && (m === "focus" || m === "off"))
        );
      }
    }
    for (const node of document.querySelectorAll("[data-count]")) {
      node.textContent = KANA[node.dataset.count].length;
    }
    onOptionsChange();
  }

  // --- Tekentabel ---

  function renderChars() {
    const { script, groups } = readOptions();
    const label = (k) => (script === "kata" ? toKatakana(k) : script === "both" ? k + toKatakana(k) : k);

    el.charTables.replaceChildren(...groups.map((g) => {
      const { label: title, cols, layout } = TABLE[g];
      const section = document.createElement("section");
      const h = document.createElement("h3");
      h.textContent = title;
      const grid = document.createElement("div");
      grid.className = "char-grid";
      grid.style.setProperty("--cols", cols);
      for (let r = 0; r < layout.length; r += cols) {
        const row = layout.slice(r, r + cols);
        const kanas = row.filter((k) => k !== "・");

        // Rij-knop met de klank (K, S, SH…); niet bij een rij van één teken (ん).
        if (kanas.length > 1) {
          const rowBtn = document.createElement("button");
          rowBtn.type = "button";
          rowBtn.className = "row-btn";
          rowBtn.dataset.row = kanas.join(",");
          rowBtn.textContent = ROMAJI.get(kanas[0]).replace(/[aiueo]$/, "").toUpperCase() || "–";
          rowBtn.setAttribute("aria-label", `Row ${kanas.map((k) => ROMAJI.get(k)).join(" ")}`);
          grid.append(rowBtn);
        } else {
          grid.append(document.createElement("span"));
        }

        for (const k of row) {
          if (k === "・") { grid.append(document.createElement("span")); continue; }
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "cell";
          cell.dataset.kana = k;
          cell.dataset.mark = markOf(k);
          const glyph = document.createElement("span");
          glyph.lang = "ja";
          glyph.dataset.font = "kyokasho";
          glyph.textContent = label(k);
          const romaji = document.createElement("small");
          romaji.textContent = ROMAJI.get(k);
          cell.append(glyph, romaji);
          grid.append(cell);
        }
      }
      section.append(h, grid);
      return section;
    }));

    refreshRows();

    if (!groups.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Choose a group first (Basic, Dakuten or Combinations).";
      el.charTables.append(p);
    }
  }

  function setMark(kana, mark) {
    if (mark === "on") delete marks[kana];
    else marks[kana] = mark;
  }

  // Gezamenlijke stand van een rij: die van de tekens als ze gelijk zijn, anders "mixed".
  function rowMark(kanas) {
    const states = new Set(kanas.map(markOf));
    return states.size === 1 ? [...states][0] : "mixed";
  }

  function refreshRows() {
    for (const btn of el.charTables.querySelectorAll(".row-btn")) {
      btn.dataset.mark = rowMark(btn.dataset.row.split(","));
    }
  }

  // --- Deck ---

  function shuffle(a) {
    const rnd = new Uint32Array(a.length);
    crypto.getRandomValues(rnd);
    for (let i = a.length - 1; i > 0; i--) {
      const j = rnd[i] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Na het schudden: geen twee dezelfde tekens direct achter elkaar (kan door "vaker"-kopieën).
  // Legt de (al geschudde) kaarten één voor één neer; het vaakst resterende teken gaat voor
  // als het anders niet meer past.
  function spreadDuplicates(a, prev) {
    const rest = a.splice(0);
    while (rest.length) {
      const last = a.length ? a[a.length - 1].kana : prev;
      const counts = new Map();
      for (const c of rest) counts.set(c.kana, (counts.get(c.kana) || 0) + 1);
      const [topKana, top] = [...counts].reduce((m, e) => (e[1] > m[1] ? e : m));
      let i = top * 2 > rest.length && topKana !== last
        ? rest.findIndex((c) => c.kana === topKana)
        : rest.findIndex((c) => c.kana !== last);
      if (i < 0) i = 0; // kan niet anders (bijv. maar één teken over)
      a.push(rest.splice(i, 1)[0]);
    }
    return a;
  }

  const shuffleDeck = (a, prev) => spreadDuplicates(shuffle(a), prev);

  function buildDeck({ script, groups }) {
    const deck = [];
    for (const { kana, romaji } of activeKana(groups)) {
      const copies = markOf(kana) === "focus" ? FOCUS_WEIGHT : 1;
      for (let n = 0; n < copies; n++) {
        if (script !== "kata") deck.push({ kana, romaji });
        if (script !== "hira") deck.push({ kana: toKatakana(kana), romaji });
      }
    }
    return shuffleDeck(deck);
  }

  // --- Spel ---

  let deck = [];
  let pos = 0;
  let card = null;
  let fonts = [];
  let font = null;
  let locked = true;
  let timerAnim = null;
  let feedbackTimer = 0;
  let score = 0;
  let total = 0;
  let streak = 0;

  function drawCard() {
    if (pos >= deck.length) {
      shuffleDeck(deck, card?.kana); // ook over de grens heen geen herhaling
      pos = 0;
    }
    return deck[pos++];
  }

  function pickFont() {
    if (fonts.length < 2) return fonts[0];
    const others = fonts.filter((f) => f !== font);
    return others[crypto.getRandomValues(new Uint32Array(1))[0] % others.length];
  }

  function renderStats() {
    el.score.textContent = `${score} / ${total}`;
    el.streak.hidden = streak < 3;
    el.streak.textContent = `${streak} in a row`;
  }

  function next() {
    card = drawCard();
    font = pickFont();
    el.card.dataset.state = "idle";
    el.kana.textContent = card.kana;
    el.kana.dataset.len = card.kana.length;
    el.kana.dataset.font = font;
    el.fontLabel.textContent = fonts.length > 1 ? FONTS[font].label : "";
    el.answer.textContent = "";
    el.input.value = "";
    locked = false;

    if (!reduceMotion.matches) {
      el.kana.animate(
        [{ opacity: 0, transform: "scale(.98)" }, { opacity: 1, transform: "none" }],
        { duration: 170, easing: "cubic-bezier(.2,.7,.3,1)" }
      );
    }

    timerAnim?.cancel();
    timerAnim = el.timer.animate(
      [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      { duration: TIME_LIMIT_MS, easing: "linear", fill: "forwards" }
    );
    timerAnim.onfinish = () => resolve(false);
  }

  function resolve(ok) {
    if (locked) return;
    locked = true;
    timerAnim.pause();

    total++;
    if (ok) { score++; streak++; } else { streak = 0; }
    el.card.dataset.state = ok ? "ok" : "bad";
    if (!ok) el.answer.textContent = card.romaji[0];
    renderStats();

    feedbackTimer = setTimeout(next, ok ? FEEDBACK_OK_MS : FEEDBACK_BAD_MS);
  }

  function start(e) {
    e.preventDefault();
    const opts = readOptions();
    deck = buildDeck(opts);
    fonts = opts.fonts.filter((f) => f in FONTS);
    if (!deck.length || !fonts.length) return;
    // Gekozen fonts alvast laden (meestal al binnen via de voorbeeldjes op het optiescherm).
    for (const f of fonts) {
      if (FONTS[f].family) document.fonts.load(`1em "${FONTS[f].family}"`, "あ").catch(() => {});
    }
    pos = 0;
    card = null;
    font = null;
    score = total = streak = 0;
    renderStats();

    el.setup.hidden = true;
    el.game.hidden = false;
    el.input.focus(); // binnen de user gesture, zodat iOS het toetsenbord opent
    next();
  }

  function stop() {
    clearTimeout(feedbackTimer);
    timerAnim?.cancel();
    locked = true;
    el.input.blur();
    el.game.hidden = true;
    el.setup.hidden = false;
    el.start.focus();
  }

  // --- Events ---

  el.options.addEventListener("change", onOptionsChange);
  el.options.addEventListener("submit", start);
  el.stop.addEventListener("click", stop);

  el.editChars.addEventListener("click", () => {
    renderChars();
    el.chars.showModal();
  });

  el.chars.addEventListener("click", (e) => {
    if (e.target === el.chars) { el.chars.close(); return; } // tik op de achtergrond
    const cell = e.target.closest(".cell");
    const row = e.target.closest(".row-btn");
    const all = e.target.closest("[data-all]");
    if (cell) {
      const mark = NEXT_MARK[markOf(cell.dataset.kana)];
      setMark(cell.dataset.kana, mark);
      cell.dataset.mark = mark;
      refreshRows();
    } else if (row) {
      const kanas = row.dataset.row.split(",");
      const current = rowMark(kanas);
      const mark = current === "mixed" ? "on" : NEXT_MARK[current];
      for (const k of kanas) {
        setMark(k, mark);
        el.charTables.querySelector(`.cell[data-kana="${k}"]`).dataset.mark = mark;
      }
      refreshRows();
    } else if (all) {
      for (const g of readOptions().groups) {
        for (const { kana } of KANA[g]) setMark(kana, all.dataset.all);
      }
      renderChars();
    } else {
      return;
    }
    onOptionsChange();
  });

  el.input.addEventListener("input", () => {
    if (!locked && card.romaji.includes(normalize(el.input.value))) resolve(true);
  });

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!locked) resolve(card.romaji.includes(normalize(el.input.value)));
  });

  // Tik ergens in het spel = toetsenbord terug.
  el.game.addEventListener("click", (e) => {
    if (!e.target.closest("button")) el.input.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.game.hidden) stop();
  });

  // Thema: standaard licht; donker wordt onthouden. Het inline script in <head> zet het al
  // vóór het tekenen, zodat er geen flits is.
  const THEME_KEY = "kana:theme";
  const themeColor = $("theme-color");
  const syncThemeColor = () => {
    themeColor.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  };
  $("theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    if (dark) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch {}
    syncThemeColor();
  });
  syncThemeColor();

  // iOS Safari verkleint de pagina niet als het toetsenbord opent; volg daarom het zichtbare deel.
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
      document.documentElement.style.setProperty("--vvt", `${vv.offsetTop}px`);
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    fit();
  }

  restoreOptions();
})();
