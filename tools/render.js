/**
 * toke_render tool — parameterised template rendering.
 *
 * Substitutes {{varname}} slots in a template string with values from vars.
 * Placeholder atoms ($PERSON_1, $LOCATION_2, etc.) are passed through unchanged.
 * Does not call tkc — pure JS string substitution.
 */

// Matches {{varname}} slots where varname is a non-empty sequence of
// word characters (letters, digits, underscores).
const SLOT_RE = /\{\{(\w+)\}\}/g;

/**
 * toke_render — render a template by substituting {{varname}} slots.
 *
 * @param {string} template - Template string with {{varname}} slots
 * @param {Record<string, string>} [vars={}] - Variable substitutions
 * @returns {{ rendered: string, unresolved_slots: string[] }}
 */
export function tokeRender(template, vars = {}) {
  const unresolved = new Set();

  const rendered = template.replace(SLOT_RE, (_match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name];
    }
    unresolved.add(name);
    return _match; // leave unresolved slot in place
  });

  return {
    rendered,
    unresolved_slots: Array.from(unresolved),
  };
}
