import { z } from 'zod';

const JAVA_RESERVED_WORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally',
  'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long',
  'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
  'true', 'try', 'void', 'volatile', 'while',
]);

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export const appConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  startUrl: z.string().regex(/^https:\/\/\S+$/).refine(isHttpsUrl, 'Must be a valid HTTPS URL'),
  packageName: z
    .string()
    .regex(/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/)
    .refine(
      (value) => !value.split('.').some((segment) => JAVA_RESERVED_WORDS.has(segment)),
      'Must not contain a Java reserved word',
    ),
  appName: z.string().trim().min(1),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const appConfigJsonSchema = z.toJSONSchema(appConfigSchema);
