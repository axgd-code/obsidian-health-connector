import en from './en';
import fr from './fr';
import es from './es';

type Locale = typeof en;

const locales: { [key: string]: Locale } = {
  en,
  fr,
  es,
};

export function getLocale(obsidianLang?: string): Locale {
  if (!obsidianLang) return en;
  
  // Extract language code (e.g., 'en', 'fr', 'es' from 'en-US', 'fr-FR', etc.)
  const langCode = obsidianLang.split('-')[0].toLowerCase();
  
  return locales[langCode] || en; // Default to English if language not found
}
