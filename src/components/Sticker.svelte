<!-- A small round "I Voted" sticker — red/white striped top, "I VOTED", blue starred bottom —
     slapped on topics you've blamed. Mimics the classic round polling-place button. -->
<script lang="ts"></script>

<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="block h-[30px] w-[30px] drop-shadow-[0_2px_3px_rgba(0,0,0,0.65)]" aria-hidden="true">
  <defs>
    <clipPath id="iv-c"><circle cx="50" cy="50" r="45.5" /></clipPath>
  </defs>

  <circle cx="50" cy="50" r="47" fill="#f7f6ef" stroke="#16233a" stroke-width="3.5" />

  <g clip-path="url(#iv-c)">
    <!-- red field + white stripes across the top -->
    <rect x="0" y="2" width="100" height="26" fill="#b22234" />
    <g fill="#f7f6ef">
      <rect x="11" y="2" width="6" height="26" /><rect x="28" y="2" width="6" height="26" />
      <rect x="45" y="2" width="6" height="26" /><rect x="62" y="2" width="6" height="26" />
      <rect x="79" y="2" width="6" height="26" />
    </g>
    <!-- blue starred bottom -->
    <rect x="0" y="66" width="100" height="34" fill="#2a4b9b" />
    <g fill="#f7f6ef">
      <circle cx="32" cy="76" r="2.6" /><circle cx="50" cy="74" r="2.6" /><circle cx="68" cy="76" r="2.6" />
      <circle cx="41" cy="86" r="2.6" /><circle cx="59" cy="86" r="2.6" />
    </g>
  </g>

  <!-- I VOTED -->
  <text x="50" y="46" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="900" fill="#16233a">I</text>
  <text x="50" y="63" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="900" fill="#16233a">VOTED</text>
</svg>
