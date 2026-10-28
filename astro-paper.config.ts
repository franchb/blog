import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://franchb.com/",
    title: "Personal blog at franchb.com",
    description: "Personal blog at franchb.com",
    author: "franchb",
    profile: "https://franchb.com/",
    ogImage: "franchbcom-og.png",
    lang: "en",
    timezone: "Europe/Moscow",
    dir: "ltr",
  },
  posts: {
    perPage: 3,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    {
      name: "github",
      url: "https://github.com/franchb",
      linkTitle: "Me at GitHub",
    },
    {
      name: "matrix",
      url: "https://matrix.to/#/@franchb:franchb.com",
      linkTitle: "Me at Matrix",
    },
    { name: "mail", url: "mailto:hello@franchb.com", linkTitle: "E-mail" },
  ],
  shareLinks: [
    { name: "whatsapp", url: "https://wa.me/?text=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "x", url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
    { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
