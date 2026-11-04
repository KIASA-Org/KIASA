// Reads every question a person can see on a Greenhouse application form. Only what is
// on show is read: a field hidden from people is not a question for this member. It
// reads and changes nothing on the page.
() => {
  const form = document.querySelector("form#application-form, form#application_form");
  if (!form) return null;

  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const noStar = text => clean(text).replace(/\s*\*\s*$/, "");
  const shown = el => {
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
  // A question's own explanation, when it has one.
  const hintOf = el => {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => /-(description|help)$/.test(id));
    return clean(ids.map(id => {
      const found = document.getElementById(id);
      return found && shown(found) ? found.innerText : "";
    }).join(" ")).slice(0, 600);
  };
  const requiredOf = el => el.required || el.getAttribute("aria-required") === "true";

  const questions = [];
  const groups = new Map();
  for (const el of form.querySelectorAll("input, textarea, select")) {
    const type = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || el.disabled) continue;
    // A dropdown keeps a second, nameless box only for the browser's own required check.
    if (!el.id && !el.name) continue;

    if (type === "file") {
      const box = el.closest(".file-upload") || el.closest(".field") || el.parentElement;
      if (!shown(box)) continue;
      const title = document.getElementById("upload-label-" + el.id);
      const group = el.closest("[role=group]");
      const required = (group && group.getAttribute("aria-required") === "true") || (title ? /\*\s*$/.test(clean(title.innerText)) : el.required);
      const attached = box.querySelector(".file-upload__filename, [class*=filename], .chosen");
      questions.push({ id: el.id, kind: "file", label: noStar(title ? title.innerText : labelOf(el)), required: !!required, filled: el.files.length > 0 || !!(attached && clean(attached.innerText)), hint: "" });
      continue;
    }
    if (!shown(el)) continue;
    // Ticking "Current role" takes away the need for that job's end date.
    const endOfJob = /^end-date-(month|year)-(\d+)$/.exec(el.id || "");
    if (endOfJob && document.querySelector(`[id^="current-role-${endOfJob[2]}_"]:checked`)) continue;

    if (type === "checkbox" || type === "radio") {
      const key = el.name || el.id;
      const set = el.closest("fieldset");
      const siblings = el.name ? form.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`) : [el];
      if (siblings.length < 2) {
        // A lone box says what it is agreeing to in its heading, and only "Acknowledge" beside it.
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
      const shell = el.closest(".select-shell") || el.parentElement;
      const picked = shell.querySelector("[class*=single-value], [class*=multi-value__label]");
      questions.push({ id: el.id, kind: "choice", label: labelOf(el), required: requiredOf(el), filled: !!picked, hint: hintOf(el), dropdown: true });
      continue;
    }

    questions.push({ id: el.id || el.name, kind: el.tagName === "TEXTAREA" ? "long_text" : "text", label: labelOf(el), required: requiredOf(el), filled: !!el.value, hint: hintOf(el) });
  }
  return questions;
}
