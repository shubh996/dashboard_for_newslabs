import { LegalDocumentPage } from '@/components/LegalDocumentPage'

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      lastUpdated="July 20, 2026"
      intro="This Privacy Policy explains how 9AM (“we”, “us”, or “our”) collects, uses, and protects information when you use the 9AM product and related services (the “Service”)."
      sections={[
        {
          heading: '1. Who we are',
          body: [
            '9AM is a market news product that helps you read stock-related stories and explore related ticker and company context. It is not a broker and does not provide investment advice. Contact privacy@9am.site with questions about this policy.',
          ],
        },
        {
          heading: '2. Information we collect',
          body: [
            'We design the Service to minimize personal data collection. Depending on how you use the Service, we may process:',
            '• Contact information you choose to send us (for example, if you email hello@9am.site or privacy@9am.site).',
            '• Preferences and account-related data you set in the product, such as theme, layout, bookmarks, and feature settings.',
            '• Technical and diagnostic data needed to operate the Service, such as basic logs and network requests to our content services.',
            '• Saved stories and interaction data used to personalize your experience.',
          ],
        },
        {
          heading: '3. How we use information',
          body: [
            'We use information to:',
            '• Deliver news, market context, and related ticker information.',
            '• Remember your preferences and saved stories.',
            '• Maintain security, fix bugs, and improve reliability.',
            '• Respond to support and privacy requests you send us.',
            'We do not sell your personal information.',
          ],
        },
        {
          heading: '4. News and market data sources',
          body: [
            'Story and market information may be loaded from our backend services and third-party data providers. Those providers process technical request data as needed to serve content. We do not control the privacy practices of external websites you open from a story’s original source link.',
          ],
        },
        {
          heading: '5. Storage',
          body: [
            'Preferences, bookmarks, and similar settings may be stored locally in your browser or device and/or associated with your account where applicable. Clearing site data may remove local data.',
          ],
        },
        {
          heading: '6. Sharing',
          body: [
            'We share information only when needed to operate the Service (for example, with infrastructure or data providers under contract), to comply with law, or to protect the rights and safety of 9AM, our users, or the public. We do not share information with third-party advertising networks for the purpose of selling your data.',
          ],
        },
        {
          heading: '7. Data retention',
          body: [
            'We retain information only as long as needed for the purposes described in this policy, unless a longer period is required by law.',
          ],
        },
        {
          heading: '8. Security',
          body: [
            'We use reasonable technical and organizational measures to protect information. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.',
          ],
        },
        {
          heading: '9. Children',
          body: [
            'The Service is not directed to children under 13 (or the minimum age required in your country). We do not knowingly collect personal information from children.',
          ],
        },
        {
          heading: '10. Your choices',
          body: [
            'You can change preferences at any time, clear local data through your browser settings, or stop using the Service. For privacy requests, email privacy@9am.site.',
          ],
        },
        {
          heading: '11. International users',
          body: [
            'If you use the Service from outside the country where our systems are hosted, your information may be processed in other countries that may have different data-protection rules.',
          ],
        },
        {
          heading: '12. Changes to this policy',
          body: [
            'We may update this Privacy Policy from time to time. When we do, we will revise the “Last updated” date. Continued use of the Service after changes means you accept the updated policy.',
          ],
        },
        {
          heading: '13. Contact',
          body: [
            '9AM',
            'privacy@9am.site',
            'hello@9am.site',
            'https://9am.site',
          ],
        },
      ]}
    />
  )
}
