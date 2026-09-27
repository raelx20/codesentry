/**
 * DeployGuard Core: Pre-Deployment Risk Assessment & Production Readiness Gate
 */

function evaluateDeployReadiness(findings = [], files = []) {
  const deployFindings = findings.filter(
    (f) =>
      f.tool === 'deployguard' ||
      f.category === 'security' ||
      (f.ruleId && f.ruleId.startsWith('deployguard-'))
  );

  let blockerCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const f of deployFindings) {
    const sev = (f.severity || '').toUpperCase();
    if (sev === 'BLOCKER') blockerCount++;
    else if (sev === 'HIGH') highCount++;
    else if (sev === 'MEDIUM') mediumCount++;
    else if (sev === 'LOW') lowCount++;
  }

  // Calculate Readiness Score: Start at 100%, deduct based on findings
  let penalty = blockerCount * 30 + highCount * 15 + mediumCount * 5 + lowCount * 2;
  const readinessScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  // Determine Gate Verdict
  let status = 'PASSED';
  let message = 'All pre-deployment security & configuration checks passed. Ready for production release.';

  if (blockerCount > 0 || readinessScore < 60) {
    status = 'BLOCKED';
    message = `Deployment blocked! Detected ${blockerCount} critical blocker(s) in configuration or infrastructure.`;
  } else if (highCount > 0 || readinessScore < 80) {
    status = 'WARNING';
    message = `Deployment requires review. ${highCount} high-priority risk(s) identified before production.`;
  }

  return {
    readinessScore,
    status, // 'PASSED' | 'WARNING' | 'BLOCKED'
    message,
    metrics: {
      blockers: blockerCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      totalIssues: deployFindings.length,
    },
    findings: deployFindings,
  };
}

module.exports = {
  evaluateDeployReadiness,
};
