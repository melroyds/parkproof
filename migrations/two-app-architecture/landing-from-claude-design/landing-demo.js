// landing-demo.js — drives the hero phone screenshots.
// 3-state machine: scan → loading → verdict → loop.
// Each state shows a real app screenshot via opacity cross-fade.

(function () {
  const stage = document.getElementById('hero-demo');
  if (!stage) return;

  const captionText = stage.querySelector('.demo-caption-text');

  const PHASES = [
    { state: 'scan',      duration: 2400, caption: 'Snap the sign' },
    { state: 'loading',   duration: 2600, caption: 'Reading the sign · ~12s' },
    { state: 'verdict',   duration: 3400, caption: 'Verdict · plain English' },
    { state: 'reminders', duration: 3000, caption: 'Reminders before tow-away' },
    { state: 'pdf',       duration: 3000, caption: 'Tamper-proof PDF export' },
    { state: 'korean',    duration: 2600, caption: 'Works in your language' },
  ];

  let phaseIdx = 0;
  let timer = null;

  function step() {
    const phase = PHASES[phaseIdx];
    stage.setAttribute('data-state', phase.state);
    if (captionText) captionText.textContent = phase.caption;
    timer = setTimeout(() => {
      phaseIdx = (phaseIdx + 1) % PHASES.length;
      step();
    }, phase.duration);
  }

  // Pause when off-screen.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        if (!timer) step();
      } else {
        if (timer) { clearTimeout(timer); timer = null; }
      }
    });
  }, { threshold: 0.2 });

  io.observe(stage);
})();
