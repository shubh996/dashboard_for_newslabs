import { Link } from 'react-router-dom'
import { LegalDocumentPage } from '@/components/LegalDocumentPage'

export default function PrivacyPage() {
  return (
    <>
      <LegalDocumentPage
        title="Privacy Policy"
        lastUpdated="September 5, 2026"
        intro="This Privacy Policy explains how we handle information when you use Trigger (the “Service”). It is written for transparency and App Store / Play Store compliance. It is not a product brochure."
        sections={[
          {
            heading: '1. Scope',
            body: [
              'This policy covers information processed in connection with the Trigger mobile app, related websites (including 9am.site), and support channels.',
              'If you do not agree with this policy, do not use the Service. For privacy requests, email privacy@9am.site.',
            ],
          },
          {
            heading: '2. Information we may process',
            body: [
              'Depending on the features you use, we may process only what is needed to operate the Service and respond to you:',
              '• Account or contact details you provide (for example, an email address used to sign in or to contact support).',
              '• Product preferences and content you create or save inside the Service (for example, monitored symbols, saved items, or similar settings).',
              '• Device and notification identifiers when push or device-linked features are enabled (for example, device IDs and push tokens).',
              '• Technical and operational data such as basic request logs, crash or error diagnostics, and security signals.',
              '• Information you send us by email or other support channels (including screenshots or device details you choose to share).',
              'We do not require you to provide more personal information than is needed for the feature you are using.',
            ],
          },
          {
            heading: '3. How we use information',
            body: [
              'We use information to:',
              '• Provide, maintain, and secure the Service.',
              '• Deliver notifications or device-linked features you enable.',
              '• Diagnose problems, prevent abuse, and improve reliability.',
              '• Respond to support, privacy, account-deletion, and similar requests.',
              '• Comply with law and enforce our policies where required.',
              'We do not sell your personal information.',
            ],
          },
          {
            heading: '4. Service providers',
            body: [
              'We use infrastructure and platform providers (for example, hosting, database/auth, and push-delivery services) to run the Service. Those providers process data only as needed to provide their services to us, under their own security and privacy commitments.',
              'Market or public data shown in the Service may come from third-party data sources. That display does not mean we sell your personal information to those sources.',
            ],
          },
          {
            heading: '5. Retention',
            body: [
              'We keep information only as long as needed for the purposes above, including to operate active accounts, provide support, meet legal obligations, and resolve disputes.',
              'When you request deletion (see below), we delete or de-identify personal information associated with your account or device, except where we must retain a limited record (for example, fraud prevention, legal compliance, or completing a deletion request).',
            ],
          },
          {
            heading: '6. Account deletion and data deletion',
            body: [
              'You may request deletion of your account and associated personal data at any time.',
              'How to request deletion:',
              '• Email hello@9am.site or privacy@9am.site with the subject line “Account deletion request”.',
              '• Include the email address or account identifier used with the Service, and (if relevant) the device or app store account context.',
              '• We will confirm the request and complete deletion within a reasonable period, typically within 30 days, unless a longer period is required by law.',
              'Uninstalling the app from your device removes the app and local data on that device. It may not automatically delete server-side account or notification records. Use the email request above for full account / server data deletion.',
              'You can also clear local site or app storage on your device through system or browser settings.',
            ],
          },
          {
            heading: '7. Your choices',
            body: [
              '• Notifications: turn off push notifications in your device settings, or disable monitoring / notification features inside the Service when available.',
              '• Access / correction: email privacy@9am.site to request access to, or correction of, personal information we hold about you.',
              '• Support issues: see the Support page or email hello@9am.site.',
            ],
          },
          {
            heading: '8. Children',
            body: [
              'The Service is not directed to children under 13 (or the minimum age required in your country). We do not knowingly collect personal information from children. If you believe a child has provided personal information, contact privacy@9am.site and we will take appropriate steps to delete it.',
            ],
          },
          {
            heading: '9. Security',
            body: [
              'We use reasonable administrative, technical, and organizational measures to protect information. No method of transmission or storage is 100% secure; please use a strong password where accounts are offered and keep your devices updated.',
            ],
          },
          {
            heading: '10. International processing',
            body: [
              'Information may be processed in countries where we or our providers operate. Where required, we use appropriate safeguards for cross-border transfers.',
            ],
          },
          {
            heading: '11. Changes',
            body: [
              'We may update this Privacy Policy from time to time. The “Last updated” date at the top will change when we do. Continued use of the Service after an update means you acknowledge the revised policy.',
            ],
          },
          {
            heading: '12. Contact',
            body: [
              'Privacy: privacy@9am.site',
              'General support: hello@9am.site',
              'Website: https://9am.site',
            ],
          },
        ]}
      />
      <div className="mx-auto max-w-3xl px-4 pb-10 text-sm">
        <Link to="/support" className="text-muted-foreground underline-offset-4 hover:underline">
          Support
        </Link>
      </div>
    </>
  )
}
