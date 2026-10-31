import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';
import { localFallbackApi } from '../lib/localFallback';
import {
  SAMPLE_CSV_STATEMENT,
  SAMPLE_OFX_STATEMENT,
  SAMPLE_QIF_STATEMENT,
} from '../lib/sampleStatements';

describe('Fasten Classic UI & Household Finance Workflows', () => {
  beforeEach(async () => {
    localStorage.clear();
    await localFallbackApi.resetAllData();
  });

  it('shows consumer welcome screen on first launch and loads sample household data', async () => {
    render(<App />);

    expect(
      await screen.findByText(/Household finances, on your computer/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Explore with sample household data/i }));

    expect(await screen.findByText('Household net worth')).toBeInTheDocument();
    expect(screen.getAllByText('Household Checking').length).toBeGreaterThan(0);
    expect(screen.getByText(/transaction needs a category/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review uncategorized/i })).toBeInTheDocument();
  });

  it('imports CSV, OFX, and QIF statements and blocks silent duplicate re-imports', async () => {
    const checking = await localFallbackApi.upsertAccount({
      name: 'Main Checking',
      accountType: 'checking',
      institution: 'Credit Union',
      openingBalanceCents: 100_000,
      openingDate: '2026-10-01',
    });

    // 1. Preview CSV with two identical same-day coffee purchases
    const csvPreview = await localFallbackApi.previewStatementImport({
      accountId: checking.id,
      fileName: 'oct.csv',
      content: SAMPLE_CSV_STATEMENT,
    });
    expect(csvPreview.detectedFormat).toBe('csv');
    expect(csvPreview.totalRows).toBe(6);
    expect(csvPreview.duplicateRows).toBe(0);

    const committed = await localFallbackApi.commitStatementImport({
      accountId: checking.id,
      sourceName: 'oct.csv',
      rows: csvPreview.rows.map((r) => ({
        postedDate: r.postedDate,
        payee: r.payee,
        originalPayee: r.originalPayee,
        memo: r.memo,
        amountCents: r.amountCents,
        categoryId: r.categoryId,
        externalId: r.externalId,
        fingerprint: r.fingerprint,
      })),
    });
    expect(committed.importedCount).toBe(6);

    // 2. Re-previewing the same CSV flags all 6 rows as duplicates
    const dupPreview = await localFallbackApi.previewStatementImport({
      accountId: checking.id,
      fileName: 'oct.csv',
      content: SAMPLE_CSV_STATEMENT,
    });
    expect(dupPreview.duplicateRows).toBe(6);
    expect(dupPreview.newRows).toBe(0);

    // 3. Preview OFX and QIF formats
    const ofxPreview = await localFallbackApi.previewStatementImport({
      accountId: checking.id,
      fileName: 'card.ofx',
      content: SAMPLE_OFX_STATEMENT,
    });
    expect(ofxPreview.detectedFormat).toBe('ofx');
    expect(ofxPreview.totalRows).toBe(4);
    expect(ofxPreview.statementBalanceCents).toBe(-63_964);

    const qifPreview = await localFallbackApi.previewStatementImport({
      accountId: checking.id,
      fileName: 'quicken.qif',
      content: SAMPLE_QIF_STATEMENT,
    });
    expect(qifPreview.detectedFormat).toBe('qif');
    expect(qifPreview.totalRows).toBe(3);
    expect(qifPreview.rows[0].postedDate).toBe('2026-10-07');
  });

  it('reconciles budgets, net worth, and backup restoration end-to-end', async () => {
    await localFallbackApi.loadSampleHouseholdData('2026-10');
    const summaryBefore = await localFallbackApi.getDashboardSummary('2026-10', '2026-10-28');
    expect(summaryBefore.assetsCents - summaryBefore.liabilitiesCents).toBe(
      summaryBefore.netWorthCents
    );

    const backup = await localFallbackApi.exportBackupJson();
    await localFallbackApi.resetAllData();
    const emptySummary = await localFallbackApi.getDashboardSummary('2026-10', '2026-10-28');
    expect(emptySummary.accounts.length).toBe(0);

    await localFallbackApi.restoreBackupJson(backup);
    const summaryAfter = await localFallbackApi.getDashboardSummary('2026-10', '2026-10-28');
    expect(summaryAfter.netWorthCents).toBe(summaryBefore.netWorthCents);
    expect(summaryAfter.totalBudgetSpentCents).toBe(summaryBefore.totalBudgetSpentCents);

    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText('Household Checking').length).toBeGreaterThan(0);
    });
  });

  it('calculates loan amortization and accelerated debt payoff savings', async () => {
    // $300,000 principal at 6.00% (600 basis points) for 360 months
    const calc = await localFallbackApi.calculateLoanAmortization(30_000_000, 600, 360, 0);
    expect(calc.monthlyPaymentCents).toBe(179_865); // $1,798.65 / mo
    expect(calc.schedule.length).toBe(360);

    // Accelerated comparison with $250 extra
    const comparison = await localFallbackApi.compareLoanPayoff(30_000_000, 600, 360, 25_000);
    expect(comparison.monthsSaved).toBeGreaterThan(60);
    expect(comparison.interestSavedCents).toBeGreaterThan(5_000_000);
  });

  it('converts monetary values to legal English check words', async () => {
    const words1 = await localFallbackApi.convertNumberToEnglishWords(12450);
    expect(words1).toBe('One Hundred Twenty-Four and 50/100 Dollars');

    const words2 = await localFallbackApi.convertNumberToEnglishWords(125000);
    expect(words2).toBe('One Thousand Two Hundred Fifty and 00/100 Dollars');
  });

  it('computes investment portfolio market value and tax schedule reports', async () => {
    const portfolio = await localFallbackApi.getPortfolioSummary();
    expect(portfolio.holdings.length).toBe(4);
    expect(portfolio.totalMarketValueCents).toBeGreaterThan(portfolio.totalCostBasisCents);

    const taxReport = await localFallbackApi.getTaxScheduleReport(2026);
    expect(taxReport.schedules.length).toBeGreaterThan(0);
    expect(taxReport.totalDeductionsCents).toBeGreaterThan(0);
  });
});
