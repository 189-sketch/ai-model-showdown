/**
 * The "made with Renoise.ai" credit link, tagged per the team's link-attribution spec
 * (Feishu 「链接追溯规范」, FicPdCYbsoDANgxwTOacMPbIntS): utm_source uses the matrix format {对接人}-{slug}.
 * utm_medium is fixed to xcom (the spec's value for X/Twitter), where the game is shared.
 */
const BASE = "https://renoise.ai/";
const UTM = { utm_medium: "xcom", utm_source: "tomato-ai-fighting-game" };

export function renoiseUrl() {
  return `${BASE}?${new URLSearchParams(UTM).toString()}`;
}
