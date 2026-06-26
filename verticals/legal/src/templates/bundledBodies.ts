// Deploy-safe, INLINED copies of the bundled document-body templates.
//
// Why these live in code as string constants instead of being read from
// templates/*.md at runtime: the legal vertical is consumed by apps/legal-demo,
// which deploys as a Next.js standalone serverless bundle. `readFileSync` of a
// repo asset (even one listed in next.config `outputFileTracingIncludes`) is not
// reliably present in the relocated function bundle — the runtime path computed
// from `import.meta.url` does not match where the traced asset lands, so the read
// throws ENOENT in production (the Templates tab 500: "no such file or directory,
// open '.../verticals/legal/templates/nc-llc-operating-agreement.md'"). Inlining
// the body bundles makes them part of the compiled JS, so they resolve in every
// environment with no filesystem dependency.
//
// These mirror the canonical bodies in verticals/legal/templates/*.md
// (nc-llc-operating-agreement.md, nc-llc-operating-agreement-multi-member.md,
// engagement-letter-oa.md). Keep them in sync if the .md files change. They are
// the Phase-0 repo FALLBACK only — an attorney-authored config template
// (transitions.document_templates) always wins over these.

export const OPERATING_AGREEMENT_SINGLE_MEMBER_BODY = `# Operating Agreement of {{company_name}}, LLC

**State of Formation:** North Carolina
**Effective Date:** {{effective_date}}

This Operating Agreement (this "**Agreement**") of **{{company_name}}, LLC** (the "**Company**"), a North Carolina limited liability company, is entered into and shall be effective as of the Effective Date set forth above, by and among the persons listed on **Schedule A** as the members of the Company (each, a "**Member**" and collectively, the "**Members**").

## Article I — Formation

1.1 **Formation.** The Company was formed under and pursuant to the North Carolina Limited Liability Company Act, N.C. Gen. Stat. Chapter 57D (the "**Act**"), upon the filing of its Articles of Organization with the North Carolina Secretary of State.

1.2 **Name.** The name of the Company is **{{company_name}}, LLC**.

1.3 **Principal Office.** The principal office of the Company shall be located at **{{principal_office_address}}**, or such other location as the Members may designate.

1.4 **Registered Agent and Registered Office.** The Company's registered agent in the State of North Carolina is **{{registered_agent_name}}**, located at **{{registered_agent_address}}**.

1.5 **Purpose.** The purpose of the Company is **{{company_purpose}}**, and to engage in any other lawful act or activity for which a limited liability company may be organized under the Act.

1.6 **Term.** The Company shall have perpetual existence unless dissolved earlier in accordance with this Agreement or the Act.

## Article II — Members and Capital Contributions

2.1 **Members.** The names, addresses, capital contributions, and ownership percentages of the Members are set forth on **Schedule A** attached to this Agreement and incorporated by reference.

2.2 **Capital Contributions.** Each Member has made the initial capital contribution set forth opposite such Member's name on Schedule A. No Member shall be obligated to make any additional capital contribution except as the Members may unanimously agree in writing.

2.3 **No Interest on Capital.** No Member shall be entitled to interest on such Member's capital contribution or capital account.

2.4 **No Withdrawal of Capital.** No Member shall have the right to withdraw any part of such Member's capital contribution except upon dissolution and winding up of the Company.

## Article III — Management

3.1 **Management Structure.** The Company shall be **{{management_structure_clause}}**.

3.2 **Authority of Managers.** {{authority_of_managers_clause}}

3.3 **Member Approval.** Notwithstanding the foregoing, the following actions shall require the affirmative approval of Members holding at least a majority of the membership interests: (a) any amendment to this Agreement or to the Articles of Organization; (b) the merger, consolidation, conversion, or sale of substantially all of the Company's assets; (c) the dissolution of the Company; (d) the admission of a new Member; and (e) the issuance of additional membership interests.

## Article IV — Allocations and Distributions

4.1 **Allocations.** Profits and losses of the Company shall be allocated to the Members in proportion to their respective ownership percentages, as set forth on Schedule A.

4.2 **Distributions.** {{distribution_policy_clause}}

4.3 **Fiscal Year.** The fiscal year of the Company shall end on **{{fiscal_year_end}}** of each year.

## Article V — Transfers of Membership Interests

5.1 **Restrictions on Transfer.** {{transfer_restrictions_clause}}

5.2 **Permitted Transfers.** Notwithstanding Section 5.1, a Member may transfer all or any portion of such Member's membership interest to (a) a member of such Member's immediate family, (b) a trust for the benefit of such Member or such Member's immediate family, or (c) an entity wholly owned by such Member, in each case without the consent of the other Members, provided that the transferee agrees in writing to be bound by this Agreement.

## Article VI — Dissolution

6.1 **Dissolution Events.** {{dissolution_triggers_clause}}

6.2 **Winding Up.** Upon dissolution, the Company shall be wound up by the Members or by such other person as the Members may designate. The assets of the Company shall be applied first to the payment of the Company's debts and liabilities, then to the establishment of reserves for contingent liabilities, and finally to the Members in proportion to their respective capital accounts.

## Article VII — Indemnification

7.1 **Indemnification.** The Company shall indemnify each Member and each manager (if any) to the fullest extent permitted by the Act against any and all liabilities, costs, and expenses incurred in connection with the Company's business, except for acts or omissions constituting gross negligence, willful misconduct, or a knowing violation of law.

## Article VIII — Miscellaneous

8.1 **Governing Law.** This Agreement shall be governed by and construed in accordance with the laws of the State of North Carolina, without regard to its conflicts of law principles.

8.2 **Entire Agreement.** This Agreement constitutes the entire agreement among the Members with respect to the subject matter hereof and supersedes all prior or contemporaneous oral or written agreements.

8.3 **Amendment.** This Agreement may be amended only by a written instrument signed by Members holding at least a majority of the membership interests, except as otherwise required by the Act.

8.4 **Counterparts.** This Agreement may be executed in one or more counterparts, each of which shall be deemed an original and all of which together shall constitute one and the same instrument. Electronic signatures shall have the same force and effect as original signatures.

---

**IN WITNESS WHEREOF**, the undersigned have executed this Operating Agreement as of the Effective Date.

{{member_signature_block}}

---

## Schedule A — Members, Capital Contributions, Ownership Percentages

{{members_schedule_table}}

---

## Ambiguities flagged by drafting agent

{{ambiguities_section}}
`

export const OPERATING_AGREEMENT_MULTI_MEMBER_BODY = `# Operating Agreement of {{company_name}}, LLC

**State of Formation:** North Carolina
**Effective Date:** {{effective_date}}
**Structure:** Multi-Member Limited Liability Company

This Operating Agreement (this "**Agreement**") of **{{company_name}}, LLC** (the "**Company**"), a North Carolina limited liability company having two (2) or more members, is entered into and shall be effective as of the Effective Date set forth above, by and among the persons listed on **Schedule A** as the members of the Company (each, a "**Member**" and collectively, the "**Members**").

## Article I — Formation

1.1 **Formation.** The Company was formed under and pursuant to the North Carolina Limited Liability Company Act, N.C. Gen. Stat. Chapter 57D (the "**Act**"), upon the filing of its Articles of Organization with the North Carolina Secretary of State.

1.2 **Name.** The name of the Company is **{{company_name}}, LLC**.

1.3 **Principal Office.** The principal office of the Company shall be located at **{{principal_office_address}}**, or such other location as the Members may designate.

1.4 **Registered Agent and Registered Office.** The Company's registered agent in the State of North Carolina is **{{registered_agent_name}}**, located at **{{registered_agent_address}}**.

1.5 **Purpose.** The purpose of the Company is **{{company_purpose}}**, and to engage in any other lawful act or activity for which a limited liability company may be organized under the Act.

1.6 **Term.** The Company shall have perpetual existence unless dissolved earlier in accordance with this Agreement or the Act.

## Article II — Members, Capital Contributions, and Ownership

2.1 **Members and Ownership Percentages.** The names, addresses, initial capital contributions, and ownership percentages (the "**Membership Interests**") of the Members are set forth on **Schedule A** attached to this Agreement and incorporated by reference. The ownership percentages on Schedule A shall total one hundred percent (100%).

2.2 **Capital Contributions.** Each Member has made the initial capital contribution set forth opposite such Member's name on Schedule A. No Member shall be obligated to make any additional capital contribution except as the Members may approve in accordance with Section 3.4. {{additional_contributions_clause}}

2.3 **Capital Accounts.** A separate capital account shall be maintained for each Member in accordance with applicable tax accounting principles. The capital account of each Member shall be increased by such Member's capital contributions and allocated share of profits, and decreased by distributions to such Member and such Member's allocated share of losses.

2.4 **No Interest on Capital.** No Member shall be entitled to interest on such Member's capital contribution or capital account.

2.5 **No Priority Among Members.** Except as expressly set forth on Schedule A or in this Agreement, no Member shall have priority over any other Member as to capital, allocations, or distributions.

## Article III — Management and Voting

3.1 **Management Structure.** The Company shall be **{{management_structure_clause}}** (member-managed or manager-managed, as determined by the Members).

3.2 **Voting Power.** Except where this Agreement or the Act requires otherwise, each Member shall be entitled to vote in proportion to such Member's ownership percentage as set forth on Schedule A, and the act of Members holding a majority of the ownership percentages shall be the act of the Members.

3.3 **Authority of Managers.** {{authority_of_managers_clause}}

3.4 **Actions Requiring Member Approval.** Notwithstanding any delegation of authority, the following actions shall require the affirmative approval of Members holding at least **{{supermajority_threshold_clause}}** of the ownership percentages: (a) any amendment to this Agreement or to the Articles of Organization; (b) the merger, consolidation, conversion, or sale of substantially all of the Company's assets; (c) the dissolution of the Company; (d) the admission of a new Member or the issuance of additional Membership Interests; (e) the incurrence of indebtedness or the grant of any security interest above a threshold the Members establish; and (f) any transaction between the Company and a Member or an affiliate of a Member.

3.5 **Deadlock.** {{deadlock_resolution_clause}}

3.6 **Meetings.** Meetings of the Members may be called by any Member holding at least twenty percent (20%) of the ownership percentages upon reasonable written notice. Members may act by written consent in lieu of a meeting, and may participate by remote communication.

## Article IV — Allocations and Distributions

4.1 **Allocations.** Profits and losses of the Company shall be allocated among the Members in proportion to their respective ownership percentages, as set forth on Schedule A, except as otherwise required by applicable tax law.

4.2 **Distributions.** {{distribution_policy_clause}} Unless the Members agree otherwise, distributions shall be made to the Members in proportion to their respective ownership percentages.

4.3 **Tax Distributions.** {{tax_distribution_clause}}

4.4 **Fiscal Year.** The fiscal year of the Company shall end on **{{fiscal_year_end}}** of each year.

## Article V — Transfers of Membership Interests

5.1 **Restrictions on Transfer.** {{transfer_restrictions_clause}} No Member may sell, assign, pledge, or otherwise transfer all or any part of such Member's Membership Interest except in accordance with this Article V.

5.2 **Right of First Refusal.** {{right_of_first_refusal_clause}} Before any Member (the "**Transferring Member**") may transfer a Membership Interest to a third party, the Transferring Member shall first offer that interest to the Company and then to the other Members, pro rata to their ownership percentages, on the same terms offered by the proposed third-party transferee.

5.3 **Permitted Transfers.** Notwithstanding Section 5.1, a Member may transfer all or any portion of such Member's Membership Interest to (a) a member of such Member's immediate family, (b) a trust for the benefit of such Member or such Member's immediate family, or (c) an entity wholly owned by such Member, in each case without the consent of the other Members, provided that the transferee agrees in writing to be bound by this Agreement.

5.4 **Admission of Transferee as Member.** A transferee of a Membership Interest shall become a substituted Member only upon the approval required under Section 3.4 and the transferee's written agreement to be bound by this Agreement; absent such approval, the transferee holds only an economic interest.

## Article VI — Withdrawal, Dissociation, and Dissolution

6.1 **Withdrawal and Buy-Sell.** {{buy_sell_clause}} Upon the death, disability, bankruptcy, or voluntary withdrawal of a Member, the Company and the remaining Members shall have the right (but not the obligation) to purchase the affected Member's Membership Interest at a price and on terms determined under this Article.

6.2 **Dissolution Events.** {{dissolution_triggers_clause}}

6.3 **Winding Up.** Upon dissolution, the Company shall be wound up by the Members or by such other person as the Members may designate. The assets of the Company shall be applied first to the payment of the Company's debts and liabilities, then to the establishment of reserves for contingent liabilities, and finally to the Members in proportion to their respective positive capital account balances.

## Article VII — Indemnification

7.1 **Indemnification.** The Company shall indemnify each Member and each manager (if any) to the fullest extent permitted by the Act against any and all liabilities, costs, and expenses incurred in connection with the Company's business, except for acts or omissions constituting gross negligence, willful misconduct, or a knowing violation of law.

## Article VIII — Miscellaneous

8.1 **Governing Law.** This Agreement shall be governed by and construed in accordance with the laws of the State of North Carolina, without regard to its conflicts of law principles.

8.2 **Entire Agreement.** This Agreement constitutes the entire agreement among the Members with respect to the subject matter hereof and supersedes all prior or contemporaneous oral or written agreements.

8.3 **Amendment.** This Agreement may be amended only by a written instrument approved by the Members in accordance with Section 3.4, except as otherwise required by the Act.

8.4 **Counterparts.** This Agreement may be executed in one or more counterparts, each of which shall be deemed an original and all of which together shall constitute one and the same instrument. Electronic signatures shall have the same force and effect as original signatures.

---

**IN WITNESS WHEREOF**, the undersigned Members have executed this Operating Agreement as of the Effective Date.

{{member_signature_block}}

---

## Schedule A — Members, Capital Contributions, and Ownership Percentages

{{members_schedule_table}}

The ownership percentages set forth above shall total 100%.

---

## Ambiguities flagged by drafting agent

{{ambiguities_section}}
`

export const ENGAGEMENT_LETTER_BODY = `# Engagement Letter — Formation of {{company_name}}, LLC

**Pacheco Law Firm**
**Date:** {{effective_date}}

**To:** {{primary_client_name}}
**Re:** Formation of **{{company_name}}, LLC** (North Carolina LLC) and preparation of operating agreement

Dear {{primary_client_salutation}},

Thank you for engaging Pacheco Law Firm (the "**Firm**") to assist with the formation of your new North Carolina limited liability company. This letter confirms the terms of our engagement.

## 1. Scope of Representation

The Firm will represent you in connection with the following matters (the "**Matter**"):

- Preparation and filing of Articles of Organization for **{{company_name}}, LLC** with the North Carolina Secretary of State.
- Preparation of an Operating Agreement for the Company, based on the information you provided during intake and our consultation.
- One round of revisions to the Operating Agreement following your review.

The following matters are **outside the scope of this engagement** unless we mutually agree otherwise in writing: tax planning beyond default LLC tax treatment, securities-law advice, drafting of employment or contractor agreements, intellectual property registration, real estate transactions, litigation, or any matter not expressly listed above. {{scope_notes_clause}}

## 2. Fees

Our fee for the Matter is **{{fee_amount_formatted}}**, structured as **{{fee_structure_human}}**. {{fee_terms_clause}}

You will also be responsible for filing fees charged by the North Carolina Secretary of State (currently $125) and any other third-party costs incurred on your behalf, which will be billed to you at cost.

## 3. Client Responsibilities

You agree to:

- Provide accurate and complete information needed for the Matter, including but not limited to the information you submitted in the intake questionnaire.
- Respond promptly to requests for information, signatures, or decisions.
- Notify the Firm promptly of any changes that may affect the Matter.

## 4. Communications

The Firm will communicate with you primarily by email at the address on file. You consent to receive communications related to the Matter electronically.

## 5. Conflicts and Confidentiality

The Firm has performed a conflicts check and is not aware of any conflict that would prevent representation in this Matter. All communications between you and the Firm will be treated as confidential and protected by the attorney-client privilege, subject to applicable exceptions under North Carolina law.

## 6. Termination

Either you or the Firm may terminate this engagement at any time upon written notice. Upon termination, you will be responsible for fees and costs incurred through the termination date.

## 7. Governing Law

This engagement is governed by the laws of the State of North Carolina.

If the foregoing accurately reflects your understanding of our engagement, please sign below and return a copy to the Firm.

Sincerely,

**Juan Carlos Pacheco**
Pacheco Law Firm

---

**Accepted and Agreed:**

Signature: ______________________________
Name: **{{primary_client_name}}**
Date: ______________________________

---

## Ambiguities flagged by drafting agent

{{ambiguities_section}}
`
