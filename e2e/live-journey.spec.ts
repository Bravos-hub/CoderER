import { expect, test } from '@playwright/test';

/**
 * Live release-certification journey: real Next.js BFF, real Nest API, real
 * PostgreSQL/Redis and seeded demo data. No API routes are mocked or
 * intercepted. Runs only when PLAYWRIGHT_LIVE=true against an external stack
 * (PLAYWRIGHT_EXTERNAL_SERVER=true), e.g. the Compose `app` profile.
 */

const live = process.env.PLAYWRIGHT_LIVE === 'true';
const judgeUsername = process.env.CODEER_JUDGE_USERNAME ?? '';
const judgePassword = process.env.CODEER_JUDGE_PASSWORD ?? '';
const frozenIncidentId = '00000000-0000-4000-8000-000000290004';

test.skip(!live, 'Live journey requires PLAYWRIGHT_LIVE=true and the external demo stack.');
test.skip(!judgeUsername || !judgePassword, 'Judge credentials are required for the live journey.');

test.describe('live judged demo journey', () => {
  test('judge signs in, reviews the frozen incident end to end, and signs out', async ({
    page,
  }) => {
    await page.goto('/judge');
    await expect(page.getByRole('heading', { name: /judge sign-in/i })).toBeVisible();

    await page.getByLabel(/username/i).fill(judgeUsername);
    await page.getByLabel(/password/i).fill(judgePassword);
    await page.getByRole('button', { name: /open demo/i }).click();

    await page.waitForURL('**/incidents');
    await expect(page).toHaveURL(/\/incidents/);

    await page.goto(`/incidents/${frozenIncidentId}`);
    await expect(
      page.getByText(/DETERMINISTIC SEEDED REPLAY/i).first(),
      'the frozen incident must display the seeded-replay disclosure',
    ).toBeVisible();
    await expect(page.getByText('ER-20260719-DEMO').first()).toBeVisible();

    for (const section of ['evidence', 'reproduction', 'investigation', 'treatment-plan']) {
      await page.goto(`/incidents/${frozenIncidentId}/${section}`);
      await expect(
        page.getByText(/DETERMINISTIC SEEDED REPLAY/i).first(),
        `seeded-replay disclosure must be visible on ${section}`,
      ).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Internal Server Error');
    }

    for (const section of ['recovery', 'verification', 'publication', 'activity']) {
      await page.goto(`/incidents/${frozenIncidentId}/${section}`);
      await expect(page.locator('main')).not.toContainText('Internal Server Error');
      await expect(page.locator('main')).not.toContainText('Incident unavailable');
    }

    const sessionCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'codeer_user_session',
    );
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite?.toLowerCase()).toBe('lax');

    await page.request.delete('/api/judge/session');
    const afterLogout = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'codeer_user_session',
    );
    expect(afterLogout === undefined || afterLogout.value === '').toBe(true);
  });

  test('judge login rejects invalid credentials with a constant response', async ({
    request,
  }) => {
    const badUsername = await request.post('/api/judge/session', {
      data: { username: 'not-the-judge', password: judgePassword },
    });
    const badPassword = await request.post('/api/judge/session', {
      data: { username: judgeUsername, password: 'definitely-wrong-password' },
    });
    expect(badUsername.status()).toBe(401);
    expect(badPassword.status()).toBe(401);
    expect(await badUsername.json()).toEqual(await badPassword.json());
    expect(badUsername.headers()['cache-control']).toBe('no-store');
  });
});
