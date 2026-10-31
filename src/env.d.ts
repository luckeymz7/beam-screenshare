/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    lang: import('./lib/i18n').Lang;
  }
}
