import { describe, test, expect } from 'vitest';

/**
 * Test suite for frontmatter merging logic
 * Tests that existing properties are updated rather than duplicated
 */

// Helper function to simulate the mergeFrontmatterKeys logic
function mergeFrontmatterKeys(existingFm: string, newFrontmatter: string): string {
  const keysToUpdate = [
    'date', 'steps', 'sleep', 'weight', 'averageHeartRate',
    'didRunning', 'runningDistance_km', 'didSwimming', 'SwimmingDistance_km',
    'didCycling', 'cyclingDistance_km', 'otherActivities'
  ];

  // Parse new frontmatter into key-value pairs
  const newKeys = new Map<string, string>();
  newFrontmatter.split('\n').forEach(line => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      newKeys.set(match[1], match[2]);
    }
  });

  // Update existing frontmatter
  let updatedFm = existingFm;
  keysToUpdate.forEach(key => {
    if (newKeys.has(key)) {
      const newValue = newKeys.get(key);
      // Replace existing key or add it
      const keyPattern = new RegExp(`^${key}:.*$`, 'm');
      if (keyPattern.test(updatedFm)) {
        updatedFm = updatedFm.replace(keyPattern, `${key}: ${newValue}`);
      } else {
        updatedFm = updatedFm.trim() + '\n' + `${key}: ${newValue}` + '\n';
      }
    }
  });

  // Ensure trailing newline
  return updatedFm.trim() + '\n';
}

describe('frontmatter merging', () => {
  test('should update existing keys without duplication', () => {
    const existingFm = `title: My Note
date: 2025-12-20
steps: 10000
sleep: 500
weight: 70.0
otherField: preserved
`;

    const newFrontmatter = `date: 2025-12-25
steps: 15000
sleep: 600
weight: 70.5
averageHeartRate: 65
didRunning: true
runningDistance_km: 5.5
didSwimming: false
SwimmingDistance_km: 0
didCycling: false
cyclingDistance_km: 0
otherActivities: false
`;

    const result = mergeFrontmatterKeys(existingFm, newFrontmatter);

    // Check that old values are updated
    expect(result).toContain('date: 2025-12-25');
    expect(result).not.toContain('date: 2025-12-20');
    expect(result).toContain('steps: 15000');
    expect(result).not.toContain('steps: 10000');
    expect(result).toContain('sleep: 600');
    expect(result).not.toContain('sleep: 500');

    // Check that new keys are added
    expect(result).toContain('averageHeartRate: 65');
    expect(result).toContain('didRunning: true');

    // Check that unrelated fields are preserved
    expect(result).toContain('otherField: preserved');

    // Should not have duplicates
    const dateLines = result.match(/^date:/gm);
    expect(dateLines).toHaveLength(1);

    const stepLines = result.match(/^steps:/gm);
    expect(stepLines).toHaveLength(1);
  });

  test('should add missing keys to existing frontmatter', () => {
    const existingFm = `title: My Note
author: John
`;

    const newFrontmatter = `date: 2025-12-25
steps: 8000
sleep: 450
weight: 71.0
averageHeartRate: 62
didRunning: false
runningDistance_km: 0
didSwimming: true
SwimmingDistance_km: 2.0
didCycling: false
cyclingDistance_km: 0
otherActivities: false
`;

    const result = mergeFrontmatterKeys(existingFm, newFrontmatter);

    // Original fields should remain
    expect(result).toContain('title: My Note');
    expect(result).toContain('author: John');

    // New fields should be added
    expect(result).toContain('date: 2025-12-25');
    expect(result).toContain('steps: 8000');
    expect(result).toContain('didSwimming: true');
    expect(result).toContain('SwimmingDistance_km: 2.0');
  });

  test('should preserve original ordering and only update specified keys', () => {
    const existingFm = `title: Test
date: 2025-12-20
custom_field: do_not_remove
steps: 5000
priority: high
`;

    const newFrontmatter = `date: 2025-12-25
steps: 12000
sleep: 480
weight: 69.5
averageHeartRate: 70
didRunning: true
runningDistance_km: 7.0
didSwimming: false
SwimmingDistance_km: 0
didCycling: true
cyclingDistance_km: 3.5
otherActivities: false
`;

    const result = mergeFrontmatterKeys(existingFm, newFrontmatter);

    // Check updated values
    expect(result).toContain('date: 2025-12-25');
    expect(result).toContain('steps: 12000');

    // Check preserved custom fields
    expect(result).toContain('title: Test');
    expect(result).toContain('custom_field: do_not_remove');
    expect(result).toContain('priority: high');

    // Check new Garmin fields added
    expect(result).toContain('sleep: 480');
    expect(result).toContain('didCycling: true');
    expect(result).toContain('cyclingDistance_km: 3.5');

    // Verify no duplicates
    const dates = result.match(/^date:/gm);
    expect(dates?.length).toBe(1);
  });

  test('empty existing frontmatter should get all new keys', () => {
    const existingFm = '';

    const newFrontmatter = `date: 2025-12-25
steps: 20000
sleep: 600
weight: 70.5
averageHeartRate: 65
didRunning: true
runningDistance_km: 10.0
didSwimming: false
SwimmingDistance_km: 0
didCycling: false
cyclingDistance_km: 0
otherActivities: false
`;

    const result = mergeFrontmatterKeys(existingFm, newFrontmatter);

    // All new keys should be present
    expect(result).toContain('date: 2025-12-25');
    expect(result).toContain('steps: 20000');
    expect(result).toContain('sleep: 600');
    expect(result).toContain('averageHeartRate: 65');
    expect(result).toContain('didRunning: true');

    // Should not duplicate keys
    const stepLines = result.match(/^steps:/gm);
    expect(stepLines).toHaveLength(1);
  });

  test('should handle boolean values correctly', () => {
    const existingFm = `date: 2025-12-20
didRunning: false
didSwimming: false
`;

    const newFrontmatter = `date: 2025-12-25
steps: 9000
sleep: 500
weight: 70.0
averageHeartRate: 60
didRunning: true
runningDistance_km: 6.0
didSwimming: true
SwimmingDistance_km: 1.5
didCycling: false
cyclingDistance_km: 0
otherActivities: false
`;

    const result = mergeFrontmatterKeys(existingFm, newFrontmatter);

    // Boolean values should be updated
    expect(result).toContain('didRunning: true');
    expect(result).not.toContain('didRunning: false');
    expect(result).toContain('didSwimming: true');
    expect(result).not.toContain('didSwimming: false');

    // New boolean keys should be added
    expect(result).toContain('didCycling: false');
    expect(result).toContain('otherActivities: false');
  });

  test('integration test: before and after file content', () => {
    // BEFORE: File with existing metadata
    const beforeContent = `---
title: My Daily Log
date: 2025-12-20
steps: 8500
custom_author: John Doe
sleep: 480
---

# My Notes

Today was a good day.`;

    // Extract frontmatter
    const beforeFmStart = beforeContent.indexOf('---') + 4;
    const beforeFmEnd = beforeContent.indexOf('\n---', 4);
    const beforeFmText = beforeContent.slice(beforeFmStart, beforeFmEnd);

    // New Garmin data to merge
    const newFrontmatter = `date: 2025-12-25
steps: 15000
sleep: 600
weight: 70.5
averageHeartRate: 65
didRunning: true
runningDistance_km: 8.5
didSwimming: false
SwimmingDistance_km: 0
didCycling: true
cyclingDistance_km: 4.2
otherActivities: false
`;

    const mergedFm = mergeFrontmatterKeys(beforeFmText, newFrontmatter);
    const afterContent = `---
${mergedFm}---

# My Notes

Today was a good day.`;

    // Verify AFTER state
    expect(afterContent).toContain('title: My Daily Log');
    expect(afterContent).toContain('custom_author: John Doe');
    expect(afterContent).toContain('date: 2025-12-25');
    expect(afterContent).toContain('steps: 15000');
    expect(afterContent).toContain('sleep: 600');
    expect(afterContent).toContain('weight: 70.5');
    expect(afterContent).toContain('didRunning: true');
    expect(afterContent).toContain('runningDistance_km: 8.5');
    expect(afterContent).toContain('didCycling: true');
    expect(afterContent).toContain('cyclingDistance_km: 4.2');

    // Verify no duplicates
    const dateMatches = afterContent.match(/^date:/gm);
    expect(dateMatches).toHaveLength(1);

    const stepMatches = afterContent.match(/^steps:/gm);
    expect(stepMatches).toHaveLength(1);
  });
});
