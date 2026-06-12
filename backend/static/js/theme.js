// Theme Manager (Dark/Light Mode)
document.addEventListener('DOMContentLoaded', () => {
    const toggleTracks = document.querySelectorAll('.toggle-track');

    // Applying the theme visually across all toggles
    // Note: The HTML class applies instantly via blocking script in <head>
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme);

    // Attach click listeners to all toggle elements
    toggleTracks.forEach(track => {
        track.addEventListener('click', () => {
            const currentTheme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            setTheme(newTheme);
        });
    });

    function setTheme(theme) {
        if (theme === 'light') {
            document.documentElement.classList.add('light');
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');

            // Update all toggles visually
            document.querySelectorAll('.toggle-track').forEach(track => {
                const thumb = track.querySelector('.toggle-thumb');
                const container = track.parentElement;
                const lightIcon = container.children[0];
                const darkIcon = container.children[2];

                // Track styling (light mode)
                track.classList.remove('bg-[#bc13fe]/20');
                track.classList.add('bg-slate-200');

                // Thumb styling (light mode)
                thumb.classList.remove('translate-x-6', 'bg-[#bc13fe]', 'shadow-[0_0_10px_#bc13fe]');
                thumb.classList.add('translate-x-0', 'bg-white', 'shadow-md');

                // Icons
                if (lightIcon && darkIcon) {
                    lightIcon.classList.remove('text-slate-400');
                    lightIcon.classList.add('text-yellow-500');
                    darkIcon.classList.remove('text-[#bc13fe]');
                    darkIcon.classList.add('text-slate-400');
                }
            });
        } else {
            document.documentElement.classList.remove('light');
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');

            // Update all toggles visually
            document.querySelectorAll('.toggle-track').forEach(track => {
                const thumb = track.querySelector('.toggle-thumb');
                const container = track.parentElement;
                const lightIcon = container.children[0];
                const darkIcon = container.children[2];

                // Track styling (dark mode)
                track.classList.add('bg-[#bc13fe]/20');
                track.classList.remove('bg-slate-200');

                // Thumb styling (dark mode)
                thumb.classList.add('translate-x-6', 'bg-[#bc13fe]', 'shadow-[0_0_10px_#bc13fe]');
                thumb.classList.remove('translate-x-0', 'bg-white', 'shadow-md');

                // Icons
                if (lightIcon && darkIcon) {
                    lightIcon.classList.add('text-slate-400');
                    lightIcon.classList.remove('text-yellow-500');
                    darkIcon.classList.add('text-[#bc13fe]');
                    darkIcon.classList.remove('text-slate-400');
                }
            });
        }
    }
});
