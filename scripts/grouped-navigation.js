document.querySelectorAll('.nav-desktop').forEach((navigation) => {
  const groups = [...navigation.querySelectorAll('.nav-group')];

  groups.forEach((group) => {
    group.addEventListener('toggle', () => {
      if (!group.open) return;
      groups.forEach((otherGroup) => {
        if (otherGroup !== group) otherGroup.open = false;
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (navigation.contains(event.target)) return;
    groups.forEach((group) => { group.open = false; });
  });

  navigation.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openGroup = groups.find((group) => group.open);
    if (!openGroup) return;
    openGroup.open = false;
    openGroup.querySelector('summary')?.focus();
  });
});
