<script lang="ts">
  import Header from '$components/Header.svelte';
  import Composer from '$components/Composer.svelte';
  import Blameboard from '$components/Blameboard.svelte';
  import ExplainerBanner from '$components/ExplainerBanner.svelte';
  import ExplainerModal from '$components/ExplainerModal.svelte';
  import Footer from '$components/Footer.svelte';
  import MakerMark from '$components/MakerMark.svelte';
</script>

<div class="space-y-6">
  <ExplainerBanner />
  <Header />
  <Composer />
  <Blameboard />
  <Footer />
  <div class="pb-4 text-[clamp(9px,2.4vw,11px)]">
    <MakerMark />
  </div>
</div>

<ExplainerModal />
