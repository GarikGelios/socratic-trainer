// Replace {key} placeholders in a template string with values from a vars object
function fillTemplate(template, vars) {
  return template.replace(/[{](\w+)[}]/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

module.exports = { fillTemplate };
