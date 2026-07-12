import { describe, expect, it } from 'vitest';
import { parseGitHubRepositoryUrl } from './index.js';

describe('parseGitHubRepositoryUrl', () => {
  it('parses canonical and git-suffixed GitHub URLs', () => {
    expect(parseGitHubRepositoryUrl('https://github.com/Bravos-hub/CoderER.git')).toEqual({
      owner: 'Bravos-hub',
      name: 'CoderER',
    });
  });

  it('rejects nested GitHub paths', () => {
    expect(() =>
      parseGitHubRepositoryUrl('https://github.com/Bravos-hub/CoderER/issues'),
    ).toThrow();
  });

  it('rejects credential-bearing and non-canonical URLs', () => {
    expect(() => parseGitHubRepositoryUrl('https://token@github.com/Bravos-hub/CoderER')).toThrow();
    expect(() => parseGitHubRepositoryUrl('https://github.com:443/Bravos-hub/CoderER')).toThrow();
    expect(() =>
      parseGitHubRepositoryUrl('https://github.com/Bravos-hub/CoderER?ref=main'),
    ).toThrow();
  });
});
