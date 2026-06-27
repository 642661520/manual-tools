<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '@/components/AppLayout.vue'
import DialogContainer from '@/components/DialogContainer.vue'

const route = useRoute()
const router = useRouter()
const ready = ref(false)

onMounted(async () => {
  await router.isReady()
  ready.value = true
})

const showLayout = computed(() => ready.value && route.path !== '/login')
</script>

<template>
  <AppLayout v-if="showLayout">
    <router-view />
  </AppLayout>
  <router-view v-else-if="ready" />
  <DialogContainer />
</template>

<style></style>
