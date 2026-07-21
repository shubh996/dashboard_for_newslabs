import { LegalDocumentPage } from '@/components/LegalDocumentPage'

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      lastUpdated="July 21, 2026"
      intro="This Privacy Policy explains how 9AM (“we”, “us”, or “our”) collects, uses, stores, and protects information when you use the 9AM product, website, and related services (the “Service”). By using the Service, you acknowledge this policy."
      sections={[
        {
          heading: '1. Who we are',
          body: [
            '9AM is a market news and market-context product that helps you read stock-related stories, explore related ticker and company information, and manage personal preferences such as saved items and monitored symbols. It is not a broker and does not provide investment, trading, tax, or legal advice.',
            'For privacy questions or requests, contact privacy@9am.site. General support is available at hello@9am.site.',
          ],
        },
        {
          heading: '2. Information we collect',
          body: [
            'Depending on how you use the Service, we may process the categories of information described below. We design the Service to collect only what we need to operate features you use.',
            '• Account and contact details you provide (for example, email address used to sign in).',
            '• Content and preferences you create in the product (saved stories, bookmarks, likes, settings, monitored tickers, and similar product data).',
            '• Device and notification-related identifiers when push or device-based features are enabled (for example, device IDs and push tokens).',
            '• Technical and operational data such as basic request logs, error diagnostics, and product usage signals needed to run and secure the Service.',
            '• Information you choose to send us by email or support channels.',
          ],
        },
        {
          heading: '3. What information Supabase stores',
          body: [
            'We use Supabase as our primary backend database and authentication platform for account-related and product data. Depending on the features you use, Supabase may store:',
            '• Authentication records tied to your sign-in identity (see Email and login information below).',
            '• Saved market news articles and related metadata (for example title, summary, source, URL, tickers, topics, timestamps, and provider payload used to display the story again).',
            '• Saved ticker / company / fund / politician or portfolio-style snapshots and related research data you or the product persist for later viewing.',
            '• Monitored ticker records used for notification and monitoring features, which may include ticker symbols, company labels, subscriber device entries, push tokens, enable/disable flags, and timestamps.',
            '• Notable price-movement or similar alert content associated with monitored tickers when those features are used and saved.',
            '• Other product tables required to operate the Service (for example caches or operational records needed to serve dashboard data).',
            'Supabase processes this data on our behalf as an infrastructure provider. Access is controlled through our application and Supabase project configuration. We do not use Supabase advertising products to sell your personal information.',
          ],
        },
        {
          heading: '4. Email and login information',
          body: [
            'If you create or use an account, we collect the email address you use to sign in. Sign-in may use email one-time codes (OTP) or similar authentication flows provided through Supabase Auth.',
            'Authentication systems may store or process:',
            '• Your email address.',
            '• Authentication session tokens and security metadata needed to keep you signed in.',
            '• Timestamps and status related to sign-in, verification, and account activity.',
            '• Optional profile fields you choose to set in the product (for example a display name or avatar image URL, if that feature is enabled).',
            'We use this information to authenticate you, secure your account, restore your session, and associate saved product data with you where the Service supports signed-in features. We do not use your login email to sell advertising lists.',
          ],
        },
        {
          heading: '5. Saved stocks, watchlists, and portfolios',
          body: [
            'The Service may allow you to save or revisit market-related items, including:',
            '• Saved news stories and bookmarks.',
            '• Liked or reported stories and similar engagement choices.',
            '• Monitored tickers / watchlist-style symbol lists.',
            '• Saved ticker dashboards, company profiles, institutional or politician portfolio snapshots, Yahoo Finance snapshots, and related research records.',
            'This data is stored so we can show your saved content again, power monitoring features, and improve continuity across sessions or devices when you are signed in. Local preferences (for example theme or layout) may also be stored in your browser or device storage.',
            'Saved market content can include public market identifiers (such as ticker symbols), third-party story metadata, and structured research outputs generated or retrieved by the Service. You control many of these items through in-product actions (save, remove, clear local data) where available.',
          ],
        },
        {
          heading: '6. Notification tokens and device data',
          body: [
            'If you enable notifications or device-based monitoring features (including mobile push where offered), we may store:',
            '• Push notification tokens (for example Expo or platform push tokens).',
            '• Device or installation identifiers associated with a subscription to monitored tickers.',
            '• Notification preference flags (for example whether alerts are enabled for a device or ticker).',
            '• Timestamps for when a subscription was created or updated.',
            'We use this information to deliver alerts about monitored symbols, price-movement notices, or related product notifications you opt into. You can typically disable notifications in device settings and/or through product controls. Removing a device subscription or requesting deletion will stop further use of that token for product notifications once processed.',
          ],
        },
        {
          heading: '7. Analytics and crash reporting',
          body: [
            'We may process limited analytics and diagnostic information to understand product performance, fix bugs, and improve reliability. This can include:',
            '• Basic usage events (for example feature loads, errors, or request failures).',
            '• Technical logs such as timestamps, route or API paths, status codes, and non-content diagnostic messages.',
            '• Crash or error reports from client or server components when failures occur.',
            '• Aggregate performance metrics (for example latency or scrape/job success rates for internal operations).',
            'We aim to avoid collecting more personal content than needed for diagnostics. Where practical, logs are minimized and retained only as long as useful for operations and security. If we use third-party analytics or crash-reporting tools, those providers process data under their own terms and only as needed to provide their services to us.',
          ],
        },
        {
          heading: '8. Third-party APIs and service providers',
          body: [
            'To operate the Service we use trusted infrastructure and data providers. Depending on features you use, this may include:',
            '• Supabase — authentication, database storage, and related backend services.',
            '• Market news and data providers (for example Polygon and other configured news or market APIs) to retrieve headlines, quotes, and related market context.',
            '• Yahoo Finance and similar market data sources used for ticker dashboards and related modules.',
            '• SEC EDGAR and related public filings sources used for company filings, holdings, and related research views.',
            '• Firecrawl or similar web-retrieval providers when the Service fetches or structures public web content (for example finance pages used for monitoring or research workflows).',
            '• AI or research destinations you choose to open (for example Perplexity, ChatGPT, Grok, or Gemini) when you leave the Service to continue a query.',
            '• Charting or brokerage destinations you choose to open (for example TradingView or Yahoo Finance pages).',
            '• Hosting, CDN, and deployment providers used to serve the website and APIs.',
            '• Email/delivery infrastructure involved in authentication codes or transactional messages.',
            'These providers may process technical request data (such as IP address, user agent, and request metadata) and the content required to fulfill the request. When you open a third-party site or app, their own privacy policies apply. We do not control third-party sites you visit from outbound links.',
          ],
        },
        {
          heading: '9. How we use information',
          body: [
            'We use information to:',
            '• Provide news, market context, dashboards, monitoring, and related product features.',
            '• Authenticate users and maintain sessions.',
            '• Remember preferences, saved items, watchlists, and notification subscriptions.',
            '• Send product notifications you enable.',
            '• Secure the Service, prevent abuse, debug issues, and improve performance.',
            '• Respond to support and privacy requests.',
            '• Comply with legal obligations.',
            'We do not sell your personal information. We do not share personal information with third-party advertising networks for the purpose of selling your data.',
          ],
        },
        {
          heading: '10. Sharing',
          body: [
            'We share information only:',
            '• With service providers who help us run the Service under contractual or equivalent safeguards (for example hosting, authentication, data APIs, and scraping infrastructure).',
            '• When required by law, regulation, legal process, or governmental request.',
            '• To protect the rights, safety, and security of 9AM, our users, or the public.',
            '• In connection with a business transfer (for example merger or acquisition), subject to appropriate protections.',
            '• With your direction or consent (for example when you open a third-party destination).',
          ],
        },
        {
          heading: '11. Data retention',
          body: [
            'We retain information only as long as needed for the purposes described in this policy, including providing the Service, maintaining security, and meeting legal requirements.',
            '• Account and saved product data is generally kept while your account or saved records remain active.',
            '• Notification tokens and device subscriptions are kept while the subscription remains enabled or until removed/replaced.',
            '• Logs and diagnostics are retained for a limited operational period unless a longer period is needed for security or legal reasons.',
            '• Local browser or device preferences remain until you clear them or uninstall the app/site data.',
          ],
        },
        {
          heading: '12. How to request deletion',
          body: [
            'You can request deletion of personal information we hold about you. To request deletion:',
            '• Email privacy@9am.site from the email address associated with your account when possible.',
            '• Include “Data deletion request” in the subject line.',
            '• Tell us which account email or device identifiers the request covers, and whether you want full account deletion or deletion of specific categories (for example saved stories, monitored tickers, or notification tokens).',
            'We will verify the request as reasonably needed and process it within a commercially reasonable period, subject to legal retention requirements and technical limitations.',
            'What deletion typically covers:',
            '• Account/login association and profile fields we control.',
            '• Saved product records tied to your account where identifiable.',
            '• Notification tokens and device subscription entries we can locate from your request.',
            'What may remain for a limited time:',
            '• Backups or logs that are rotated on a normal schedule.',
            '• Records we must keep for security, fraud prevention, accounting, or legal compliance.',
            '• Public or third-party content that is not personal to you (for example a market headline already published by a news source).',
            'You may also clear local browser/app storage yourself and disable push permissions in your device settings at any time.',
          ],
        },
        {
          heading: '13. Your choices and rights',
          body: [
            'Depending on your location, you may have rights to access, correct, delete, or restrict certain processing of personal information, or to object to certain uses. You can exercise these rights by emailing privacy@9am.site.',
            'You can also:',
            '• Update or remove many in-product saves and preferences directly in the Service.',
            '• Sign out of your account.',
            '• Disable notifications in device settings.',
            '• Clear local site data in your browser or uninstall the app.',
            '• Stop using the Service.',
          ],
        },
        {
          heading: '14. Security',
          body: [
            'We use reasonable technical and organizational measures to protect information, including access controls on backend systems and transport encryption where supported. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.',
          ],
        },
        {
          heading: '15. Children',
          body: [
            'The Service is not directed to children under 13 (or the minimum age required in your country). We do not knowingly collect personal information from children. If you believe a child has provided us personal information, contact privacy@9am.site and we will take appropriate steps to delete it.',
          ],
        },
        {
          heading: '16. International users',
          body: [
            'If you use the Service from outside the country where our systems or providers are hosted, your information may be processed in other countries that may have different data-protection rules. Where required, we take steps designed to protect information in accordance with this policy.',
          ],
        },
        {
          heading: '17. Changes to this policy',
          body: [
            'We may update this Privacy Policy from time to time. When we do, we will revise the “Last updated” date at the top of this page. Continued use of the Service after changes means you accept the updated policy, except where applicable law requires additional notice or consent.',
          ],
        },
        {
          heading: '18. Contact',
          body: [
            'For privacy questions, access requests, or deletion requests, contact:',
            '9AM',
            'Privacy: privacy@9am.site',
            'Support: hello@9am.site',
            'Website: https://9am.site',
          ],
        },
      ]}
    />
  )
}
