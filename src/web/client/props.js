/* 本地矢量道具，与枪械共用木质、金属与旧物色调。 */
const itemArt = (() => {
    let sequence = 0;
    const shapes = {
        phone: `<path class="phone-cord" d="M73 39q15 3 7 10t1 10q9 9-3 17" fill="none" stroke="#5c665f" stroke-width="3"/>
            <path fill="url(#@metal)" d="M24 40h48l8 35q0 6-8 6H23q-7 0-7-6Z"/>
            <path fill="#303b35" stroke="#819186" d="M29 37h36l8 33H23Z"/>
            <g class="phone-dial"><circle cx="48" cy="59" r="16" fill="#a59a78" stroke="#302f27"/><circle cx="48" cy="59" r="8" fill="#29352f"/><path d="M48 46v3m9 1-2 2m6 7h-3m-1 9-2-2m-7 6v-3m-9-1 2-2m-6-7h3m1-9 2 2" stroke="#242c28" stroke-width="5"/><circle cx="48" cy="59" r="3" fill="#ded2b1"/></g>
            <g class="phone-receiver"><path d="M16 35q0-22 32-22t32 22l-16 6-7-14H39l-7 14Z" fill="url(#@metal)" stroke="#19251f" stroke-width="2"/><path d="M22 26q24-18 52 0" fill="none" stroke="#9aa79b" stroke-opacity=".65"/><path d="m17 33 15 4m32 0 15-4" stroke="#111e19" stroke-width="4"/></g>`,
        saw: `<path d="M12 40 62 27 77 43 66 49 62 44 57 53 52 48 46 58 41 53 35 63 30 58 24 68 14 63Z" fill="url(#@steel)" stroke="#374149"/>
            <path d="m16 43 44-11" stroke="#f1f2e8" stroke-opacity=".7"/><path d="m20 48 22-6m-17 11 28-8" stroke="#64717b" stroke-width=".7"/>
            <path d="M62 27 75 20Q81 19 84 25L92 44Q93 49 88 51L78 55 70 44 78 39 73 30 68 34Z" fill="url(#@wood)" stroke="#352318" stroke-width="2"/><circle cx="70" cy="31" r="2" fill="#bfc1ad"/><circle cx="80" cy="48" r="2" fill="#bfc1ad"/>`,
        beer: `<path d="M40 18h17v16l9 16v32q0 6-7 6H36q-6 0-6-6V50l10-16Z" fill="url(#@amber)" stroke="#3c2818" stroke-width="2"/>
            <path d="M36 53v27M44 25v10l-8 17" stroke="#eed49b" stroke-opacity=".5" stroke-width="3"/>
            <path d="M31 54h34v22H31Z" fill="#cab485" stroke="#7a6548"/><path d="m35 58 26 14m-26 0 26-14" stroke="#8c734a"/><text x="48" y="69" font-size="10" text-anchor="middle" fill="#3b392c" stroke="none" font-family="serif">BEER</text>
            <g class="bottle-cap"><rect x="38" y="12" width="21" height="8" rx="2" fill="url(#@steel)"/><path d="M41 13v6m5-6v6m5-6v6m5-6v6" stroke="#465248"/></g>`,
        adrenaline: `<g transform="rotate(38 48 48)"><path d="M48 71v20" stroke="#c8d6dc" stroke-width="2"/>
            <rect x="36" y="29" width="24" height="43" rx="3" fill="#c6d6cf" fill-opacity=".85" stroke="#566b67"/>
            <path class="syringe-liquid" d="M39 49h18v19H39Z" fill="#b65740"/><path d="M40 33v34" stroke="#f1f4df" stroke-opacity=".8"/>
            <path d="M51 35h7m-5 7h5m-7 7h7m-5 7h5m-7 7h7" stroke="#445856" stroke-width="1"/>
            <path d="M30 28h36" stroke="#9eaba4" stroke-width="5"/>
            <g class="syringe-plunger"><path d="M45 10h6v25h-6Z" fill="url(#@steel)"/><rect x="33" y="8" width="30" height="6" rx="2" fill="#657b70"/><path d="M37 35h22v5H37Z" fill="#26362f"/></g></g>`,
        inverter: `<rect x="20" y="19" width="56" height="62" rx="9" fill="url(#@metal)" stroke="#16201c" stroke-width="2"/>
            <rect x="26" y="25" width="44" height="31" rx="4" fill="#182823" stroke="#657b70"/>
            <path class="inverter-arrows" d="m34 35 8-6v4h18v7H42v4Zm28 13-8 6v-4H36v-6h18v-4Z" fill="#a8c5aa"/>
            <rect x="32" y="62" width="32" height="11" rx="5" fill="#111d18"/>
            <circle class="inverter-switch" cx="40" cy="67" r="6" fill="url(#@steel)"/>
            <circle cx="27" cy="75" r="1.5" fill="#b5bcb1"/><circle cx="69" cy="75" r="1.5" fill="#b5bcb1"/>`,
        cigarette: `<g class="cigarette-stick" transform="rotate(-23 48 48)"><rect x="13" y="43" width="68" height="13" rx="2" fill="#ddd5b7" stroke="#80795e"/>
            <path d="M15 44h23v11H15Z" fill="url(#@wood)"/><path d="m18 46 3 7m3-7 3 7m3-7 3 7" stroke="#d3a271" stroke-width=".7"/>
            <path d="M42 44h35" stroke="#fff7d7" stroke-opacity=".8"/>
            <path d="M78 43h7v13h-7Z" fill="#675849"/><path class="cigarette-ember" d="M80 45h4v9h-4Z" fill="#e18139"/></g>
            <g class="cigarette-smoke" fill="none" stroke="#bbc3b9" stroke-width="2" opacity=".65"><path d="M80 32c-14-10 8-14-1-26"/><path d="M85 30c-5-8 8-10 4-16"/></g>`,
        jammer: `<path d="M36 32 25 7m34 25L70 7" stroke="#73827b" stroke-width="5"/><path d="m27 11 7 19m33-19-7 19" stroke="#b8c1ad" stroke-width="1"/>
            <rect x="23" y="30" width="51" height="55" rx="7" fill="url(#@metal)" stroke="#16231d" stroke-width="2"/>
            <rect x="31" y="38" width="35" height="18" rx="2" fill="#172e25"/><path class="jammer-wave" d="m34 48 6-4 4 8 5-12 5 9 8-4" stroke="#b1c998" fill="none"/>
            <circle class="jammer-led" cx="62" cy="67" r="3" fill="#b78c46"/><path d="M31 66h20m-20 6h20m-20 6h20" stroke="#0b1711" stroke-width="2"/>`,
        glass: `<g class="glass-lens"><circle cx="42" cy="38" r="24" fill="#a4c4bf" fill-opacity=".24" stroke="url(#@steel)" stroke-width="7"/><path d="M25 35a18 18 0 0 1 24-14" fill="none" stroke="#deeee4" stroke-width="3" opacity=".7"/></g><path d="m59 57 22 24" stroke="#5c422b" stroke-width="13" stroke-linecap="round"/><path d="m62 58 6 7" stroke="#a0a79b" stroke-width="14"/><path d="m68 70 9 9" stroke="#b48151" stroke-width="2"/>`,
        cuffs: `<path class="cuffs-chain" d="m36 41 13 10 11-10" fill="none" stroke="url(#@steel)" stroke-width="7"/>
            <g class="cuff-left"><ellipse cx="25" cy="51" rx="16" ry="22" fill="none" stroke="url(#@steel)" stroke-width="7"/><rect x="16" y="27" width="19" height="12" rx="3" fill="url(#@metal)"/><circle cx="25" cy="34" r="2" fill="#0e1918"/></g>
            <g class="cuff-right"><ellipse cx="70" cy="51" rx="16" ry="22" fill="none" stroke="url(#@steel)" stroke-width="7"/><rect x="61" y="27" width="19" height="12" rx="3" fill="url(#@metal)"/><circle cx="70" cy="34" r="2" fill="#0e1918"/></g>`,
        medicine: `<g class="medicine-pack"><path d="m23 19 51 7-8 61-51-7Z" fill="url(#@steel)" stroke="#65716e"/><path d="m27 25 41 6-6 49-41-6Z" fill="#99a29a"/>
            <g fill="#e0ddd0" stroke="#75867e"><ellipse cx="37" cy="37" rx="7" ry="10"/><ellipse cx="57" cy="40" rx="7" ry="10"/><ellipse cx="33" cy="62" rx="7" ry="10"/></g><ellipse cx="53" cy="65" rx="7" ry="10" fill="#4e6159"/><path d="m48 58 10 13m-10 0 10-13" stroke="#829389"/></g>
            <g class="medicine-pill"><ellipse cx="78" cy="76" rx="7" ry="11" fill="#e4dfc9" stroke="#8d9587" transform="rotate(35 78 76)"/><path d="m73 72 10 7" stroke="#aaa88c"/></g>`,
        remote: `<g transform="rotate(-18 48 48)"><rect x="30" y="11" width="36" height="75" rx="9" fill="url(#@metal)" stroke="#15231c" stroke-width="2"/><rect x="36" y="18" width="24" height="13" rx="2" fill="#23382b"/><path class="remote-led" d="M40 24h16" stroke="#b5cfa4" stroke-width="2"/>
            <circle class="remote-button" cx="48" cy="45" r="9" fill="#a26648" stroke="#3c2b22"/><path d="M48 39v6m-4-3a6 6 0 1 0 8 0" stroke="#d7c4a2" fill="none"/>
            <g fill="#15251c" stroke="#5c7565"><circle cx="40" cy="64" r="3"/><circle cx="55" cy="64" r="3"/><circle cx="40" cy="74" r="3"/><circle cx="55" cy="74" r="3"/></g></g>`
    };

    return key => {
        const id = `prop-${++sequence}`;
        const art = (shapes[key] || shapes.adrenaline).replaceAll('@', id);

        return `<svg class="item-art" data-item-art="${key}" viewBox="0 0 96 96" aria-hidden="true"><defs>
            <linearGradient id="${id}steel"><stop stop-color="#3c4b50"/><stop offset=".4" stop-color="#cad2cb"/><stop offset=".65" stop-color="#899d9c"/><stop offset="1" stop-color="#36454b"/></linearGradient>
            <linearGradient id="${id}metal"><stop stop-color="#1c2b25"/><stop offset=".4" stop-color="#596e5f"/><stop offset="1" stop-color="#253b31"/></linearGradient>
            <linearGradient id="${id}wood"><stop stop-color="#543422"/><stop offset=".45" stop-color="#b28656"/><stop offset="1" stop-color="#64402c"/></linearGradient>
            <linearGradient id="${id}amber"><stop stop-color="#302716"/><stop offset=".4" stop-color="#8d6425"/><stop offset=".7" stop-color="#57451d"/><stop offset="1" stop-color="#222b16"/></linearGradient>
            </defs><g class="prop-body">${art}</g></svg>`;
    };
})();
