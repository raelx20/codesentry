const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions, renderSelectView, Select, promptActionOnTab } = require('../../../src/cli/components/select');
const { formatStatusIndicator, StatusIndicator, getStatusColor } = require('../../../src/cli/components/status-indicator');
const { Typewriter, getRandomProgrammingMessage, PROGRAMMING_MESSAGES } = require('../../../src/cli/components/typewriter');
const { createProgressTracker, PROGRESS_STATES } = require('../../../src/cli/progress');

describe('CLI Components', () => {
  describe('Select Component', () => {
    it('should normalize string options to objects', () => {
      const options = ['development', 'staging', 'production'];
      const normalized = normalizeOptions(options);

      assert.equal(normalized.length, 3);
      assert.deepEqual(normalized[0], {
        label: 'development',
        value: 'development',
        description: '',
        badge: '',
      });
      assert.equal(normalized[1].value, 'staging');
      assert.equal(normalized[2].value, 'production');
    });

    it('should normalize mixed object options', () => {
      const options = [
        { label: 'Laguna S 2.1', value: 'poolside/laguna-s-2.1:free', badge: 'RECOMMENDED' },
        { label: 'Auto', value: 'auto', description: 'Smart detection' },
      ];
      const normalized = normalizeOptions(options);

      assert.equal(normalized.length, 2);
      assert.equal(normalized[0].label, 'Laguna S 2.1');
      assert.equal(normalized[0].badge, 'RECOMMENDED');
      assert.equal(normalized[1].description, 'Smart detection');
    });

    it('should render select view with active highlight and card border', () => {
      const view = renderSelectView({
        label: 'Deploy target',
        items: [
          { label: 'development', value: 'development' },
          { label: 'staging', value: 'staging' },
          { label: 'production', value: 'production' },
        ],
        activeIndex: 1,
        width: 70,
      });

      assert.ok(view.includes('Deploy target'));
      assert.ok(view.includes('development'));
      assert.ok(view.includes('staging'));
      assert.ok(view.includes('production'));
      assert.ok(view.includes('2/3'));
    });

    it('should fallback gracefully in non-interactive environment', async () => {
      let captured = null;
      const result = await Select({
        label: 'Deploy target',
        options: ['development', 'staging', 'production'],
        defaultIndex: 1,
        onSelect: (env) => { captured = env; },
      });

      assert.equal(result, 'staging');
      assert.equal(captured, 'staging');
    });

    it('should return defaultAction in non-interactive environment for promptActionOnTab', async () => {
      const action = await promptActionOnTab({
        defaultAction: 'rescan',
      });
      assert.equal(action, 'rescan');
    });
  });

  describe('StatusIndicator Component', () => {
    it('should format online status indicator with green dot', () => {
      const formatted = formatStatusIndicator({
        status: 'online',
        label: 'OpenRouter AI active',
      });
      assert.ok(formatted.includes('●'));
      assert.ok(formatted.includes('OpenRouter AI active'));
    });

    it('should format warning/loading status indicator', () => {
      const formatted = formatStatusIndicator({
        status: 'warning',
        label: 'High issue volume',
      });
      assert.ok(formatted.includes('⚠'));
      assert.ok(formatted.includes('High issue volume'));
    });

    it('should support animated pulsing frames', () => {
      const indicator = new StatusIndicator({
        status: 'online',
        label: 'Scanning',
        pulse: true,
      });

      const frame1 = indicator.toString();
      const frame2 = indicator.nextFrame();
      assert.ok(frame1.includes('Scanning'));
      assert.ok(frame2.includes('Scanning'));
    });
  });

  describe('Typewriter Component', () => {
    it('should step through text characters and display cursor', () => {
      const tw = new Typewriter({ text: 'Discovering files...', cursor: true });
      assert.equal(tw.isDone(), false);

      const step1 = tw.step();
      assert.ok(step1.startsWith('D'));
      assert.ok(step1.includes('▌'));

      for (let i = 0; i < 30; i++) {
        tw.step();
      }

      assert.equal(tw.isDone(), true);
      assert.equal(tw.render(), 'Discovering files...');
    });

    it('should reset text cleanly', () => {
      const tw = new Typewriter({ text: 'First' });
      tw.step();
      tw.step();
      tw.setText('Second message');
      assert.equal(tw.isDone(), false);
      assert.equal(tw.visibleLength, 0);
    });

    it('should provide rich programming telemetry messages', () => {
      const discoveringMsg = getRandomProgrammingMessage('discovering');
      const analyzingMsg = getRandomProgrammingMessage('analyzing');
      const aiMsg = getRandomProgrammingMessage('ai_analysis');

      assert.ok(typeof discoveringMsg === 'string' && discoveringMsg.length > 0);
      assert.ok(typeof analyzingMsg === 'string' && analyzingMsg.length > 0);
      assert.ok(typeof aiMsg === 'string' && aiMsg.length > 0);
      assert.ok(PROGRAMMING_MESSAGES.analyzing.length >= 5);
    });
  });

  describe('ProgressTracker with Typewriter & StatusIndicator', () => {
    it('should initialize and transition through states', () => {
      const progress = createProgressTracker({ verbose: false });
      progress.start();
      progress.update(PROGRESS_STATES.DISCOVERING);
      progress.update(PROGRESS_STATES.ANALYZING);
      const summary = progress.complete(true);

      assert.equal(summary.success, true);
      assert.equal(summary.steps.length, 2);
    });
  });
});
