# Rich push images (news alerts)

Server-side news alerts send:

```json
{
  "title": "NVDA ↑ · AAPL ↓ · MSFT",
  "body": "Full article headline goes here…",
  "richContent": { "image": "https://…/photo.jpg" },
  "mutableContent": true,
  "data": {
    "type": "news_alert",
    "headline": "Full article headline goes here…",
    "image_url": "https://…/photo.jpg",
    "rich_image_attached": true,
    "ticker_sides": [{ "ticker": "NVDA", "side": "bullish", "arrow": "↑" }]
  }
}
```

- **`title` (header)** → tickers with arrows: bullish `↑`, bearish `↓`, **neutral = no arrow**  
  e.g. `NVDA ↑ · AAPL ↓ · MSFT`  
- **`body`** → **full** article headline (never truncated server-side)  
- **`richContent.image`** → OS lock-screen / expanded notification image  
- **`data.image_url` / `data.headline`** → in-app only

Dashboard send logs include `sample_expo_payload`, `rich_content_attached`, and `image_probe`.

---

## Deep-link `data` payload (tap handling)

### News alert

```json
{
  "type": "news_alert",
  "kind": "news",
  "screen": "news",
  "article_id": "<uuid>",
  "news_id": "<uuid>",
  "id": "<uuid>",
  "path": "/news/<uuid>",
  "deep_link": "nineam://news/<uuid>",
  "url": "https://…",
  "headline": "Full article title…",
  "notification_title": "NVDA ↑ · AAPL ↓",
  "notification_body": "Full article title…",
  "image_url": "https://…",
  "source_name": "…",
  "published_at": "…",
  "provider": "…",
  "tickers": ["NVDA", "AAPL"],
  "ticker_sides_json": "[{\"ticker\":\"NVDA\",\"side\":\"bullish\",\"arrow\":\"↑\"}]"
}
```

App: on notification response, read `data.article_id` (or `news_id` / `id`) and open that article.

### Notable price movement (ticker alert)

```json
{
  "type": "notable_price_movement",
  "kind": "notable_move",
  "screen": "notable_move",
  "ticker": "AAPL",
  "company_name": "Apple",
  "path": "/ticker/AAPL",
  "deep_link": "nineam://ticker/AAPL?kind=notable_move&event_date=2026-07-22",
  "event_date": "2026-07-22",
  "display_date": "Jul 22",
  "time_label": "10:35 AM ET",
  "price": "$324.47",
  "price_change": "+1.00%",
  "momentum": "+1.00%",
  "reason": "…",
  "summary": "…",
  "notification_title": "AAPL +1.00% · Notable move",
  "notification_body": "…"
}
```

App: if `data.kind === "notable_move"` (or `type === "notable_price_movement"`), open ticker screen for `data.ticker` (optional `event_date`).

---

## Android (usually works out of the box)

1. App uses `expo-notifications` (or FCM) with default display.
2. Payload includes `richContent.image` with a **public HTTPS** URL.
3. Device can download that URL (no auth wall, not blocked by CDN).
4. Prefer image URLs that return `Content-Type: image/jpeg` or `image/png`.

### Channel note

This dashboard **does not send `channelId` by default** for news/custom alerts.  
If the app never created `news-alert`, a forced channelId can hide the whole notification.

To opt into a named channel from the API body:

```json
{ "article_id": "…", "use_named_channel": true }
```

or

```json
{ "article_id": "…", "channel_id": "news-alert" }
```

Only do this if the app creates that channel on startup.

---

## iOS — Notification Service Extension (required for images)

Apple does **not** show remote image URLs on the lock screen unless the app has a **Notification Service Extension (NSE)** that downloads the image and attaches it before display.

Expo documents this on `richContent`: Android works OOTB; **iOS needs an NSE**.  
Reference: [Expo push message format → `richContent`](https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format) and [expo PR #36202](https://github.com/expo/expo/pull/36202).

### Checklist

#### 1. Enable mutable content (server already does this)

Server sets:

- `mutableContent: true`
- `richContent: { image: "<https-url>" }`

Without `mutableContent: true`, the NSE is not invoked.

#### 2. Add a Notification Service Extension target (Xcode / EAS)

**Option A — Expo config plugin / community templates**

- Follow Expo’s rich push / NSE example (PR linked above).
- Or use a maintained config plugin that injects an NSE for `expo-notifications` rich images.

**Option B — Manual Xcode (bare / prebuild)**

1. Open `ios/*.xcworkspace` after `npx expo prebuild`.
2. **File → New → Target → Notification Service Extension** (e.g. `NineAMNotificationService`).
3. Set deployment target ≥ your main app’s.
4. Embed the extension in the app target (**Embed Foundation Extensions**).
5. App Groups optional unless you share data with the main app.

#### 3. Implement `didReceive(_:withContentHandler:)`

In the NSE, when a notification arrives:

1. Read image URL from:
   - preferred: APNs payload path that Expo maps for `richContent.image`, **or**
   - fallback: `userInfo["body"]` / custom keys — with Expo, also check `userInfo` for nested image; many apps read:

   ```swift
   // Pseudocode — exact key path depends on Expo/APNs mapping
   let imageURLString =
     (bestAttemptContent.userInfo["richContent"] as? [String: Any])?["image"] as? String
     ?? (bestAttemptContent.userInfo["image"] as? String)
     ?? (bestAttemptContent.userInfo["body"] as? [String: Any])?["image_url"] as? String
   // Also try data payload keys Expo forwards under "body" / "data"
   ```

2. Download the image to a temp file (`URLSession`).
3. Create `UNNotificationAttachment(identifier:url:options:)`.
4. Attach to `bestAttemptContent.attachments`.
5. Call `contentHandler(bestAttemptContent)` within ~30s (extension time limit).

On failure, still call `contentHandler` with the text-only content so the user gets title/body.

#### 4. App entitlements & capabilities

- Push Notifications capability on main app.
- Background Modes → Remote notifications (if you use background fetch patterns).
- Correct APNs environment (development vs production) matching the build.
- Same Apple team / bundle id prefix for extension: e.g. `site.9am.app` + `site.9am.app.NineAMNotificationService`.

#### 5. EAS Build

- NSE must be part of the native project committed or generated by a config plugin on every build.
- Rebuild a **new binary** after adding NSE — OTA JS updates cannot add an NSE.
- Test on a **real device** (rich attachments often unreliable on Simulator).

#### 6. Verify end-to-end

| Step | Expected |
|------|----------|
| Dashboard Send news | Logs: `rich_content_attached: true`, `sample_expo_payload.has_richContent: true` |
| Expo push ticket | `status: ok` |
| Android device | Expanded notification shows image |
| iOS **without** NSE | Title + body only (image missing) — **expected** |
| iOS **with** NSE | Title + body + image attachment |

#### 7. Common iOS failures

| Symptom | Likely cause |
|---------|----------------|
| No image, text OK | NSE missing or not embedded in the IPA |
| No image | NSE not reading Expo’s image key path |
| No image | Image URL not HTTPS or CDN blocks Apple’s network |
| No image | Attachment download exceeds NSE time limit |
| No notification | Wrong APNs cert / `DeviceNotRegistered` |

---

## In-app fallback (works without NSE)

Even without lock-screen images, the app can open the article and show `data.image_url` when the user taps the notification:

```ts
// expo-notifications response listener (app JS)
const data = response.notification.request.content.data
const imageUrl = data?.image_url
const articleId = data?.article_id
// navigate to news detail and render <Image source={{ uri: imageUrl }} />
```

This does **not** replace lock-screen rich images on iOS; it only improves the in-app experience.

---

## Server / dashboard debugging

After **Send** on News alert, open the right-hand **Logs** rail:

- `rich_content_attached` — whether Expo payload included `richContent.image`
- `image_probe` — HTTPS check / content-type / HTTP status from our probe
- `sample_expo_payload` — redacted payload shape actually sent
- `channel_note` — whether a named Android channel was used

If `rich_content_attached` is **false**, fix the image URL first.  
If it is **true** and Android shows image but iPhone does not → finish the **iOS NSE checklist** above.
