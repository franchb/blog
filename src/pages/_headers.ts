export function get() {
  return {
    body:
      ".well-known/matrix/*\n" +
      "  X-Frame-Options: DENY\n" +
      "  Access-Control-Allow-Origin: *\n" +
      "  Content-Type: application/json",
  };
}
