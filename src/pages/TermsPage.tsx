import { LegalDocumentPage } from '@/components/LegalDocumentPage'

export default function TermsPage() {
  return (
    <LegalDocumentPage
      title="Terms of Use"
      lastUpdated="July 20, 2026"
      intro="These Terms of Use (“Terms”) govern your access to and use of the 9AM product and related services (the “Service”). By using the Service, you agree to these Terms."
      sections={[
        {
          heading: '1. Agreement',
          body: [
            'These Terms form a binding agreement between you and 9AM. If you do not agree, do not use the Service.',
          ],
        },
        {
          heading: '2. The service',
          body: [
            '9AM provides market news, story summaries, related ticker context, and supporting market information for personal, non-commercial use unless we agree otherwise in writing.',
            'Features may change, be limited, or be discontinued at any time as we improve the product.',
          ],
        },
        {
          heading: '3. Not investment advice',
          body: [
            'All content in the Service is for general information only. Nothing in the Service is investment, trading, tax, legal, or other professional advice. We do not recommend any security, strategy, or transaction.',
            'You are solely responsible for your investment decisions. Always do your own research and consult a qualified professional when needed.',
          ],
        },
        {
          heading: '4. Accuracy and availability',
          body: [
            'News and market data can be delayed, incomplete, or incorrect. Third-party sources may change or become unavailable without notice. We do not guarantee that any content is accurate, complete, current, or suitable for any particular purpose.',
            'The Service may be unavailable during maintenance, outages, or network issues.',
          ],
        },
        {
          heading: '5. Acceptable use',
          body: [
            'You agree not to:',
            '• Misuse the Service, attempt unauthorized access, or interfere with its operation.',
            '• Scrape, bulk download, or redistribute content except as allowed by law or with our written permission.',
            '• Use the Service for unlawful, deceptive, or harmful activity.',
            '• Reverse engineer the Service except where applicable law allows it.',
          ],
        },
        {
          heading: '6. Intellectual property',
          body: [
            'The Service, its design, branding, and original content are owned by 9AM or its licensors. News headlines, articles, and market data may be owned by third parties and remain subject to their rights.',
            'These Terms do not transfer ownership of any intellectual property to you.',
          ],
        },
        {
          heading: '7. Third-party links and services',
          body: [
            'The Service may link to third-party websites, brokers, or data providers. We are not responsible for third-party content, products, or practices. Your use of third-party services is governed by their terms and policies.',
          ],
        },
        {
          heading: '8. Disclaimers',
          body: [
            'THE SERVICE AND ALL CONTENT ARE PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.',
          ],
        },
        {
          heading: '9. Limitation of liability',
          body: [
            'To the maximum extent permitted by law, 9AM and its officers, employees, and partners will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, or opportunities, arising from your use of the Service or reliance on any content.',
            'Our total liability for any claim relating to the Service will not exceed the greater of (a) the amount you paid us for the Service in the 12 months before the claim, or (b) USD $50.',
          ],
        },
        {
          heading: '10. Indemnity',
          body: [
            'You agree to defend and indemnify 9AM against claims, damages, and expenses arising from your misuse of the Service or violation of these Terms, to the extent permitted by law.',
          ],
        },
        {
          heading: '11. Termination',
          body: [
            'We may suspend or end access to the Service at any time if we believe you have violated these Terms or if we discontinue the service. You may stop using the Service at any time.',
          ],
        },
        {
          heading: '12. Changes',
          body: [
            'We may update these Terms from time to time. The “Last updated” date will change when we do. Continued use of the Service after updates means you accept the revised Terms.',
          ],
        },
        {
          heading: '13. Governing law',
          body: [
            'These Terms are governed by the laws applicable in the jurisdiction where 9AM principally operates, without regard to conflict-of-law rules, except where mandatory consumer protections in your country apply.',
          ],
        },
        {
          heading: '14. Contact',
          body: [
            'Questions about these Terms:',
            'hello@9am.site',
            'https://9am.site',
            '9AM',
          ],
        },
      ]}
    />
  )
}
