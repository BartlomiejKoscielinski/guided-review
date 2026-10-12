/** Shiki grammars the app loads (docs/04 › Stack › Highlighting). */
export const LANGUAGES = [
  'csharp',
  'xml',
  'json',
  'yaml',
  'markdown',
  'kotlin',
  'java',
  'swift',
  'objective-c',
] as const;

export type Language = (typeof LANGUAGES)[number];

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  cs: 'csharp',
  csx: 'csharp',
  xaml: 'xml',
  xml: 'xml',
  csproj: 'xml',
  props: 'xml',
  targets: 'xml',
  resx: 'xml',
  config: 'xml',
  plist: 'xml',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-c',
  h: 'objective-c',
};

/** The grammar for a file path, or null (shown as plain text). */
export function languageOf(path: string): Language | null {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
