import Legal from './Legal.jsx';

export default function Privacy() {
  return (
    <Legal title="Privacy Policy" updated="28 September 2026" version="2026-09-28">
      <p>
        This policy explains what personal information PanHost collects, why, who we share it with, and the choices
        you have. PanHost is operated by Jason Stein, carrying on business as PanHost, in Ontario, Canada. We handle
        personal information in accordance with Canada&rsquo;s <em>Personal Information Protection and Electronic
        Documents Act</em> (PIPEDA).
      </p>

      <h2>1. Who is responsible</h2>
      <p>
        Jason Stein is accountable for the personal information under our control and acts as our Privacy Officer.
        You can reach the Privacy Officer at{' '}
        <a href="mailto:jayschalets@gmail.com">jayschalets@gmail.com</a>, or by mail at 76 Park Street West,
        Mississauga, Ontario L5H 1K9, Canada.
      </p>

      <h2>2. Two different roles</h2>
      <p>This matters, because it determines who answers to whom:</p>
      <ul>
        <li>
          <strong>For your account information</strong> &mdash; the details of you, our user &mdash; we are
          responsible, and this policy governs.
        </li>
        <li>
          <strong>For your guests&rsquo; information</strong> &mdash; the names, contact details and booking records
          you or your connected platforms put into PanHost &mdash; you are responsible. We process it only as a
          service provider, on your instructions, to operate the Service for you. You are accountable to your guests
          for how it is collected and used, and you need your own privacy practices for them.
        </li>
      </ul>

      <h2>3. What we collect</h2>
      <p>
        <strong>Account information.</strong> Your name, email address, a securely hashed password, your business or
        brand details, and your currency and branding preferences.
      </p>
      <p>
        <strong>Date of birth.</strong> Collected once, at sign-up, for the sole purpose of confirming you are at
        least 18 and legally able to contract. We do not use it for anything else.
      </p>
      <p>
        <strong>Proof of agreement.</strong> The date and time you accepted our Terms and this policy, which
        versions you accepted, and the IP address you accepted from. We keep this as evidence that the agreement was
        formed.
      </p>
      <p>
        <strong>Property and business data.</strong> Listings, photos, descriptions, rates, calendars, expenses,
        invoices, tasks and statements you enter or import.
      </p>
      <p>
        <strong>Guest and booking data.</strong> Guest names, email addresses, stay dates, party size, amounts paid,
        messages and reviews &mdash; entered by you or imported from a connected platform.
      </p>
      <p>
        <strong>Payment information.</strong> If you take payments, card details are collected and processed
        directly by our payment processor. <strong>We never see or store full card numbers.</strong>
      </p>
      <p>
        <strong>Technical information.</strong> IP address, browser and device details, pages accessed, and
        timestamps, recorded in server logs for security and troubleshooting.
      </p>
      <p>We do not collect health information, government identifiers, or biometric data.</p>

      <h2>4. Why we collect it</h2>
      <ul>
        <li>to create and secure your account, and to verify you are 18 or older;</li>
        <li>to provide the Service &mdash; listings, calendars, pricing, messaging, reporting;</li>
        <li>to send transactional messages such as booking notifications, invoices and staff invitations;</li>
        <li>to detect, prevent and investigate fraud, abuse and security incidents;</li>
        <li>to diagnose faults and improve reliability; and</li>
        <li>to meet our legal, tax and record-keeping obligations.</li>
      </ul>
      <p>
        We do not sell personal information, we do not rent it, and we do not use your guest data to market to your
        guests.
      </p>

      <h2>5. Consent</h2>
      <p>
        You consent to this policy when you create an account. Where we want to use information for a new purpose
        not described here, we will ask first. You may withdraw consent at any time, subject to legal and
        contractual limits &mdash; but withdrawing consent for information we need to run the Service means we can
        no longer provide it to you.
      </p>
      <p>
        Commercial emails, if we ever send them, are sent in accordance with Canada&rsquo;s Anti-Spam Legislation
        (CASL) and always contain an unsubscribe link. Transactional messages about your account and bookings are
        not marketing and continue while your account is open.
      </p>

      <h2>6. Who we share it with</h2>
      <p>We share personal information only with service providers who need it to run the Service:</p>
      <ul>
        <li><strong>Database hosting</strong> &mdash; Supabase, with the database located in Canada (Central).</li>
        <li><strong>Application hosting</strong> &mdash; Render, with servers located in the United States.</li>
        <li><strong>Website delivery</strong> &mdash; Vercel, using a global content delivery network.</li>
        <li><strong>Payment processing</strong> &mdash; Stripe or an equivalent provider.</li>
        <li><strong>Email delivery</strong> &mdash; our transactional email provider.</li>
        <li>
          <strong>Booking platforms</strong> &mdash; Airbnb, Vrbo, Booking.com and similar, where you choose to
          connect them.
        </li>
        <li><strong>Market data</strong> &mdash; providers of comparable-listing information.</li>
      </ul>
      <p>
        We may also disclose information where the law requires it, to enforce our Terms, or to protect the rights
        and safety of users or the public. If our business is sold or reorganized, information may transfer to the
        purchaser, who must continue to protect it under this policy.
      </p>

      <h2>7. Information stored outside Canada</h2>
      <p>
        Your database records are stored in Canada, but our application servers are in the{' '}
        <strong>United States</strong> and our website is delivered through a global network. This means personal
        information is processed outside Canada. While it is outside Canada it is subject to the laws of that
        country, and courts, law enforcement and national security authorities there may be entitled to access it
        under those laws. By using the Service you acknowledge this transfer.
      </p>

      <h2>8. How long we keep it</h2>
      <ul>
        <li><strong>Account and business records</strong> &mdash; for as long as your account is open.</li>
        <li>
          <strong>After you close your account</strong> &mdash; deleted or anonymized within 90 days, except where
          we must keep records longer.
        </li>
        <li>
          <strong>Financial and tax records</strong> &mdash; retained as long as Canadian tax law requires,
          generally six years.
        </li>
        <li><strong>Security logs</strong> &mdash; generally up to 12 months.</li>
        <li>
          <strong>Proof of agreement</strong> &mdash; kept for the life of the account and for a reasonable period
          afterwards, so that we can show what was agreed.
        </li>
      </ul>

      <h2>9. How we protect it</h2>
      <p>
        We use encryption in transit (HTTPS), encryption at rest at our database provider, passwords stored only as
        salted bcrypt hashes, access controls that separate each account&rsquo;s data, role-based permissions for
        staff accounts, and rate limiting on sign-in. Access is limited to those who need it.
      </p>
      <p>
        No system is perfectly secure, and we cannot guarantee absolute security. Protecting your own password and
        device is your responsibility.
      </p>

      <h2>10. If there is a breach</h2>
      <p>
        If a breach of security safeguards creates a real risk of significant harm, we will report it to the Office
        of the Privacy Commissioner of Canada and notify affected individuals as soon as feasible, as PIPEDA
        requires, and keep a record of the breach. Where the affected information belongs to your guests, we will
        notify you so you can meet your own obligations to them.
      </p>

      <h2>11. Your rights</h2>
      <p>You may ask us to:</p>
      <ul>
        <li>tell you what personal information we hold about you and how it has been used and disclosed;</li>
        <li>provide you with a copy of it;</li>
        <li>correct it if it is inaccurate or incomplete; or</li>
        <li>delete it, subject to our legal retention obligations.</li>
      </ul>
      <p>
        Write to the Privacy Officer at <a href="mailto:jayschalets@gmail.com">jayschalets@gmail.com</a>. We will
        respond within <strong>30 days</strong>. We may need to verify your identity first, and there is no charge
        for a reasonable request.
      </p>

      <h2>12. Cookies and local storage</h2>
      <p>
        We do not use advertising or third-party tracking cookies. We store a sign-in token and a small number of
        preferences in your browser&rsquo;s local storage so you stay signed in; clearing your browser data signs you
        out. Our hosting providers may set essential cookies for security and load balancing.
      </p>

      <h2>13. Children</h2>
      <p>
        The Service is for adults running an accommodation business. It is not directed at children and we do not
        knowingly collect personal information from anyone under 18. If we learn that we have, we will delete it and
        close the account.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        We may update this policy. Each version is dated and numbered. If a change is material we will give you
        reasonable notice by email or in the Service before it takes effect.
      </p>

      <h2>15. Complaints</h2>
      <p>
        If you are not satisfied with how we have handled your personal information, contact the Privacy Officer
        first &mdash; we would rather fix it directly. If you remain unsatisfied, you may complain to the{' '}
        <strong>Office of the Privacy Commissioner of Canada</strong>, 30 Victoria Street, Gatineau, Quebec K1A 1H3,
        1-800-282-1376, <a href="https://www.priv.gc.ca" target="_blank" rel="noreferrer">priv.gc.ca</a>.
      </p>
    </Legal>
  );
}
