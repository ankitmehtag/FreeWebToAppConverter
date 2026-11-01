import { describe, expect, it } from 'vitest';
import { androidString } from '../src/xml';

describe('androidString', () => {
  it.each([
    ['Plain', '"Plain"'],
    ['Tom & Jerry', '"Tom &amp; Jerry"'],
    ['</string><evil/>', '"&lt;/string&gt;&lt;evil/&gt;"'],
    ['say "hi"', '"say \\&quot;hi\\&quot;"'],
    ["it's", '"it\\\'s"'],
    ['back\\slash', '"back\\\\slash"'],
    ['\\u0041', '"\\\\u0041"'],
    ['@string/x', '"\\@string/x"'],
    ['?attr/y', '"\\?attr/y"'],
    ['two  spaces', '"two  spaces"'],
  ])('escapes %s', (input, output) => {
    expect(androidString(input)).toBe(output);
  });
});
