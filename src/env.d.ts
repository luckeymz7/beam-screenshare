/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    lang: import('./lib/i18n').Lang;
    /** Logged-in person, or null: beam works the same without an account */
    user: import('./lib/auth').User | null;
  }
}
