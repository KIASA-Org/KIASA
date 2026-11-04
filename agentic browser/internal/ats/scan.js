// Reads every question a person can see on a standard HTML application form. The form is
// the element matching the given selector. Only what is on show is read; a field hidden
// from people is not a question for this member. It reads and changes nothing on the page.
(selector) => {
  const form = document.querySelector(selector);
  if (!form) return null;

  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const noStar = text => clean(text).replace(/\s*\*\s*$/, "");
  const shown = el => {
    if (!el) return false;
    for (let at = el; at && at !== document.body; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const byIds = ids => clean((ids || "").split(/\s+/).filter(Boolean).map(id => {
    const found = document.getElementById(id);
    return found ? found.innerText : "";
  }).join(" "));
  const labelOf = el => {
    const named = el.labels && el.labels.length ? el.labels[0].innerText : "";
    return noStar(named || byIds(el.getAttribute("aria-labelledby")) || el.getAttribute("aria-label") || el.getAttribute("placeholder"));
  };
  const hintOf = el => {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => /-(description|help|hint|sublabel)$/.test(id));
    return clean(ids.map(id => {
      const found = document.getElementById(id);
      return found && shown(found) ? found.innerText : "";
    }).join(" ")).slice(0, 600);
  };
  const requiredOf = el => el.required || el.getAttribute("aria-required") === "true";
  // A file field's input is often hidden on purpose, so its label comes from the widget
  // around it, and its star from that widget or a group.
  const fileLabel = el => {
    const group = el.closest("[role=group]");
    const spot = el.closest(".file-upload, [class*=upload], [class*=attach], .field, .field-wrapper") || el.parentElement;
    const title = document.getElementById("upload-label-" + el.id) || (spot ? spot.querySelector("label, .label, legend") : null);
    const named = title ? title.innerText : labelOf(el);
    const required = (group && group.getAttribute("aria-required") === "true") || (title ? /\*\s*$/.test(clean(title.innerText)) : false) || el.required;
    const near = spot || el.parentElement;
    const name = near ? near.querySelector("[class*=filename], [class*=file-name], .chosen, [data-filename]") : null;
    return { label: noStar(named), required: !!required, filled: el.files.length > 0 || !!(name && clean(name.innerText)) };
  };

  const questions = [];
  const groups = new Map();
  for (const el of form.querySelectorAll("input, textarea, select")) {
    const type = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || el.disabled) continue;
    if (!el.id && !el.name) continue;

    if (type === "file") {
      const spot = el.closest(".file-upload, [class*=upload], .field, .field-wrapper") || el.parentElement;
      if (spot && !shown(spot)) continue;
      const f = fileLabel(el);
      questions.push({ id: el.id || el.name, kind: "file", label: f.label, required: f.required, filled: f.filled, hint: "" });
      continue;
    }
    if (!shown(el) && el.getAttribute("role") !== "combobox") continue;

    if (type === "checkbox" || type === "radio") {
      const key = el.name || el.id;
      const set = el.closest("fieldset");
      const siblings = el.name ? form.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`) : [el];
      if (siblings.length < 2) {
        const heading = set ? set.querySelector("legend") : null;
        questions.push({ id: el.id || key, kind: "checkbox", label: heading ? noStar(heading.innerText) : labelOf(el), required: requiredOf(el) || (!!set && set.getAttribute("aria-required") === "true"), filled: el.checked, hint: hintOf(el) });
        continue;
      }
      let group = groups.get(key);
      if (!group) {
        const legend = set ? set.querySelector("legend") : null;
        group = { id: key, kind: type === "radio" ? "choice" : "multi_choice", label: noStar(legend ? legend.innerText : labelOf(set || el)), required: requiredOf(el) || (!!set && set.getAttribute("aria-required") === "true"), filled: false, hint: hintOf(el), options: [] };
        groups.set(key, group);
        questions.push(group);
      }
      group.options.push(labelOf(el));
      group.filled = group.filled || el.checked;
      continue;
    }

    if (el.tagName === "SELECT") {
      questions.push({ id: el.id || el.name, kind: el.multiple ? "multi_choice" : "choice", label: labelOf(el), required: requiredOf(el), filled: !!el.value, hint: hintOf(el), options: [...el.options].filter(o => o.value).map(o => clean(o.text)), native: true });
      continue;
    }

    if (el.getAttribute("role") === "combobox") {
      const shell = el.closest(".select-shell, [class*=select], [class*=combobox]") || el.parentElement;
      const picked = shell ? shell.querySelector("[class*=single-value], [class*=multi-value], [class*=selected]") : null;
      questions.push({ id: el.id || el.name, kind: "choice", label: labelOf(el), required: requiredOf(el), filled: !!(picked && clean(picked.innerText)) || !!el.value, hint: hintOf(el), dropdown: true });
      continue;
    }

    questions.push({ id: el.id || el.name, kind: el.tagName === "TEXTAREA" ? "long_text" : "text", label: labelOf(el), required: requiredOf(el), filled: !!el.value, hint: hintOf(el) });
  }
  return questions;
}
