import type { Site, SocialObjects } from "./types";
import og from "./assets/images/franchbcom-og.png";

import type { GiscusProps } from "@giscus/react";

export const SITE: Site = {
  website: "https://franchb.com/",
  author: "franchb",
  profile: "https://franchb.com/",
  desc: "Personal blog at franchb.com",
  title: "Personal blog at franchb.com",
  ogImage: og.src,
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 3,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
};

export const LOCALE = {
  lang: "en", // html lang code. Set this empty and default will be "en"
  langTag: ["en-EN"], // BCP 47 Language Tags. Set this empty [] to use the environment default
} as const;

export const LOGO_IMAGE = {
  enable: true,
  svg: true,
  width: 216,
  height: 46,
};

export const SOCIALS: SocialObjects = [
  {
    name: "Github",
    href: "https://github.com/franchb",
    linkTitle: `Me at GitHub`,
    active: true,
  },
  // {
  //   name: "LinkedIn",
  //   href: "https://github.com/satnaing/astro-paper",
  //   linkTitle: `${SITE.title} on LinkedIn`,
  //   active: true,
  // },
  {
    name: "Matrix",
    href: "https://matrix.to/#/@franchb:franchb.com",
    linkTitle: `Me at Matrix`,
    active: true,
  },
  {
    name: "Mail",
    href: "mailto:hello@franchb.com",
    linkTitle: `E-mail`,
    active: true,
  },
  {
    name: "Twitter",
    href: "https://twitter.com/@_tshaped",
    linkTitle: `${SITE.title} on Twitter`,
    active: false,
  },
  {
    name: "Discord",
    href: "https://github.com/satnaing/astro-paper",
    linkTitle: `${SITE.title} on Discord`,
    active: false,
  },
  {
    name: "GitLab",
    href: "https://github.com/satnaing/astro-paper",
    linkTitle: `${SITE.title} on GitLab`,
    active: false,
  },
  {
    name: "Mastodon",
    href: "https://github.com/satnaing/astro-paper",
    linkTitle: `${SITE.title} on Mastodon`,
    active: false,
  },
];

export const GISCUS: GiscusProps = {
  repo: "franchb/blog",
  repoId: "R_kgDOJHBtBA",
  category: "Announcements",
  categoryId: "DIC_kwDOJHBtBM4CiNsd",
  mapping: "pathname",
  reactionsEnabled: "0",
  emitMetadata: "0",
  inputPosition: "bottom",
  lang: "en",
  loading: "lazy",
};
