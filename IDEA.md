# Plan: An open-source Quicken Classic alternative for Publik

Date: October 31, 2026
Status: In active v1 implementation (`Fasten Classic`).

## Resolved decisions (October 31, 2026)

- **Catalog validation**: Re-verified live Publik catalog (`https://publikhq.com/apps`, 110 active listings as of October 31, 2026). Only one business ERP listing (`BAccounting Core`) exists; zero consumer household finance, personal budgeting, or Quicken Classic replacements are listed.
- **Product name & branding**: **Fasten Classic** (`14` chars, within Publik's 18-char limit; `alternativeTo: "Quicken Classic"`).
- **Technical stack**: Built from scratch using **Tauri v2 + React + TypeScript + SQLite** (`rusqlite` bundled), storing all amounts locally in integer cents (`i64`) for exact ledger math.
- **Platforms & license**: **Windows and macOS** (built locally on Windows first, with cross-platform GitHub Actions CI packaging for Windows and macOS), released under the **MIT License**.
- **First-release scope**: Full v1 MVP covering accounts, transactions, CSV/OFX/QIF statement import previews with duplicate detection, editable categorization rules, monthly budgets, recurring bills & reminders, spending & net worth reports, and local backup/restore.

## Goal

Build a consumer desktop app for household finances and publish it on [Publik](https://publikhq.com/). The target is an independent, open-source alternative to Quicken Classic, with a simpler household-focused experience.

## Recommendation and opportunity

Quicken Classic is a proprietary desktop application for Windows and Mac covering budgeting, expenses, bills, investments, and net worth. Its subscription model creates an opportunity for a locally stored, subscription-free alternative.

Publik appears to be missing a Quicken replacement. The research for this conversation checked the visible catalog and searched indexed Publik pages for Quicken and related finance terms without finding a matching listing. This is a preliminary finding, not proof of absence: unindexed listings may exist. Recheck the live catalog before committing to development and before publication.

Quicken itself is closed-source, but open-source personal finance alternatives already exist, including GnuCash. The opportunity is a simpler consumer experience and an apparent gap in Publik's catalog, rather than the first open-source finance application.

## Product pitch

> Your household finances, on your computer. No subscription.

Serve people who want to understand spending, plan monthly budgets, remember bills, and track their household's financial position without needing accounting expertise.

## Proposed first version

- Import bank statements through CSV, OFX, and QIF.
- Automatically categorize spending using editable categorization rules.
- Set monthly budgets and show spending against each budget.
- Track recurring bills and provide reminders.
- Show account balances, spending trends, and net worth.
- Store data locally and provide straightforward backup and restore.

Begin with statement imports. Automatic bank connections add considerable complexity and should be considered after the core experience works well.

## Suggested delivery sequence

1. Validate the gap: recheck Publik and compare the intended household workflow with existing open-source alternatives.
2. Define the product: choose a name, initial desktop platform, technical stack, and open-source license. These decisions remain open.
3. Build the core: accounts, transactions, statement import previews, duplicate detection, and editable categories.
4. Add household planning: monthly budgets, recurring bills, spending reports, and net worth.
5. Finish local data handling: backups, restore, and clear import error messages.
6. Validate realistic workflows: import sample statements, correct categories, reconcile balances, and confirm backup restoration preserves data.
7. Prepare distribution: installable desktop release, public source repository, license, documentation, screenshots, and a concise Publik listing.
8. Check Publik's current publishing requirements and submit the finished app.

This sequence is a proposed next-step plan, not a claim that any development or publishing has happened.

## First-release acceptance criteria

- A user can import supported statement formats and review transactions before saving.
- Reimporting a statement does not silently duplicate transactions.
- Categories and categorization rules can be corrected by the user.
- Budget totals, balances, and net worth match the underlying transactions and accounts.
- The core household workflow works offline.
- Backup and restore preserve the user's accounts, transactions, categories, and budgets.
- Installation and first-use instructions are understandable to a nontechnical consumer.

## Open decisions

- Product name and branding. *(Resolved: Fasten Classic)*
- Windows first, macOS first, or both at launch. *(Resolved: Windows local build first + Windows & macOS CI release builds)*
- Build from scratch or adapt a suitable existing open-source project. *(Resolved: Build from scratch)*
- Technical stack, license, and release packaging. *(Resolved: Tauri v2 + React + TypeScript + SQLite, MIT License)*
- Exact first-release scope and later approach to bank synchronization. *(Resolved: Statement-first v1 MVP; direct bank sync deferred past v1)*

## Sources

- [Publik catalog](https://publikhq.com/apps): catalog checked for the apparent listing gap.
- [Quicken Classic Deluxe](https://www.quicken.com/products/classic-deluxe/): product positioning and features.
- [Quicken subscription membership FAQs](https://www.quicken.com/support/quicken-subscription-membership-faqs/): desktop availability, local data storage, and subscription model.
- [GnuCash](https://gnucash.org/): existing open-source personal finance software.
- [GnuCash import features](https://gnucash.org/features/download.phtml): existing QIF and OFX import functionality.
