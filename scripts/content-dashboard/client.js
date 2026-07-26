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
