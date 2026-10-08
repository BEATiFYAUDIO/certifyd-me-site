document.querySelectorAll('.nav-desktop .nav-group').forEach((group) => {
  if (group.querySelector('summary')?.textContent?.trim() !== 'About') return;
  const menu = group.querySelector('.nav-group-menu');
  if (!menu || menu.querySelector('a[href="/core/guide/"]')) return;
  const link = document.createElement('a');
  link.href = '/core/guide/';
  link.textContent = 'Learn Certifyd Core';
  menu.append(link);
});

document.querySelectorAll('.nav-mobile .nav-drawer').forEach((drawer) => {
  if (drawer.querySelector('a[href="/core/guide/"]')) return;
  const link = document.createElement('a');
  link.href = '/core/guide/';
  link.textContent = 'Learn Certifyd Core';
  const profile = drawer.querySelector('a[href="/profile/"]');
  if (profile) profile.after(link);
  else drawer.prepend(link);
});

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
