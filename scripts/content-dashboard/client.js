function markGenerating(form) {
  form.classList.add('is-generating');
  form.setAttribute('aria-busy', 'true');
  const progress = form.querySelector('.generation-progress');
  if (progress) progress.hidden = false;
  const submitters = form.querySelectorAll('button[type="submit"]');
  for (const button of submitters) {
    button.dataset.originalLabel = button.textContent || '';
    button.textContent = 'Generating…';
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.matches('[data-generating-form]')) return;
  markGenerating(form);
});

document.addEventListener('click', async (event) => {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;
  const targetId = button.dataset.copyTarget;
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
  await navigator.clipboard.writeText(target.value);
  const original = button.textContent || 'Copy';
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = original; }, 1200);
});
