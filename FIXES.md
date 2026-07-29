# oiforster/postiz-app — Production fixes fork

This is a fork of [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) with bug fixes that were reported by the community but not merged into the upstream open source repository.

All fixes have been **tested in production** on a self-hosted instance (Ubuntu Server 24.04, Instagram Standalone API, Tailscale Funnel).

---

## Applied fixes

### 1. Instagram scopes updated to `business_` variants
**Issue:** [#1578](https://github.com/gitroomhq/postiz-app/issues/1578)  
**File:** `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`

Meta deprecated the old Instagram permission scopes. The old names (`instagram_basic`, `instagram_content_publish`, etc.) were replaced with `business_` variants in the current API. Without this fix, connecting an Instagram account fails with a permissions error.

---

### 2. Bounded polling + permalink error handling
**Issue:** [#1562](https://github.com/gitroomhq/postiz-app/issues/1562)  
**File:** `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`

The original code had an infinite `while (status === 'IN_PROGRESS')` loop with two problems:
- Meta randomly returns HTTP errors (subcode 33) during status polling — this crashed the loop and the post was marked as failed even when it published successfully
- No timeout — posts could hang forever if Meta never returned `FINISHED`

Fix: wrap poll in try/catch, add max wait (180s for video, 15s for images).

---

### 3. cover_url support for Reel thumbnails
**Issue:** [#1572](https://github.com/gitroomhq/postiz-app/issues/1572)  
**File:** `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`

Added `cover_url` parameter when publishing Reels with a custom thumbnail. Without this, the thumbnail field in Postiz was silently ignored and Instagram used the first frame as cover.

---

### 4. Avatar upload failure no longer blocks account connection
**Issue:** [#918](https://github.com/gitroomhq/postiz-app/issues/918)  
**File:** `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`

If the avatar upload failed during Instagram account connection (network error, invalid URL, CDN timeout), the entire connection threw an error and the user couldn't connect their account. Fix: catch the error, log it, and continue without avatar.

---

### 5. Auth cookie fix for Tailscale Funnel, ngrok, localtunnel and other PSL domains
**File:** `libraries/helpers/src/subdomain/subdomain.management.ts`

Self-hosted instances accessed via **Tailscale Funnel** (`*.ts.net`), **ngrok** (`*.ngrok.io`), **localtunnel** (`*.loca.lt`) or any tunnel service whose domain is on the [Public Suffix List](https://publicsuffix.org/) could not log in.

The auth cookie was set with `Domain=.ts.net` — browsers silently reject this (RFC 6265 §5.3) because setting a cookie on a PSL entry would allow cross-user cookie sharing. The session cookie was never stored, causing an infinite redirect loop on every login attempt.

Fix: return `undefined` when `tldts` detects a PSL domain → cookie is set without `Domain` attribute (host-only) → accepted by all browsers.

### 6. Instagram collaborators on carousel posts
**Issue:** [#1547](https://github.com/gitroomhq/postiz-app/issues/1547)  
**File:** `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`

Publishing a carousel with collaborators always failed. Postiz sent the `collaborators`
parameter on each child media creation call (`is_carousel_item=true`), where Meta rejects it
with `param collaborators is not allowed for carousel child`. The parameter belongs on the
parent container (`media_type=CAROUSEL`), which never received it.

Fix: hoist the parameter out of the media loop, skip it on carousel children, and append it
to the CAROUSEL container call. Also wraps the value in `encodeURIComponent()`, matching how
every other JSON parameter in the same function is encoded.

Verified against the live Graph API on an **Instagram Login** account
(`graph.instagram.com`, i.e. a standalone connection without a linked Facebook Page):
the child call returns `param collaborators is not allowed for carousel child`, while the
CAROUSEL container accepts the parameter and proceeds to resolve the usernames. A real
two-image carousel with a collaborator published successfully end to end.

---

---

## How to use this fork

Replace `gitroomhq/postiz-app` with `oiforster/postiz-app` in your Docker setup:

```yaml
# docker-compose.yml
services:
  postiz:
    build:
      context: .
      dockerfile: Dockerfile
    # Clone this fork and build locally, or use the pre-built image
```

Or clone and build:

```bash
git clone https://github.com/oiforster/postiz-app.git
cd postiz-app
# follow upstream build instructions
```

---

## Why these fixes aren't in the upstream

The upstream repository (`gitroomhq/postiz-app`) requires contributors to apply at `contribute.postiz.com` and sign a CLA (Contributor License Agreement) before PRs are accepted. The CLA grants the company rights to use community contributions in their commercial cloud product.

These fixes were submitted as PRs [#1600](https://github.com/gitroomhq/postiz-app/pull/1600), [#1601](https://github.com/gitroomhq/postiz-app/pull/1601) and [#1602](https://github.com/gitroomhq/postiz-app/pull/1602) but were automatically closed pending CLA approval.

This fork exists to make the fixes available to the self-hosted community without bureaucratic friction.

---

## Contributing

Found another bug? Open an issue or PR here. No CLA required.
