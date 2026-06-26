import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
  },
  {
    path: '/',
    redirect: '/features',
  },
  {
    path: '/features',
    name: 'feature-list',
    component: () => import('@/views/feature-list/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/features/:id/edit',
    name: 'feature-editor',
    component: () => import('@/views/feature-editor/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/catalogs/:id',
    name: 'catalog-builder',
    component: () => import('@/views/catalog-builder/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/preview',
    name: 'preview-index',
    component: () => import('@/views/manual-preview/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/preview/:id',
    name: 'manual-preview',
    component: () => import('@/views/manual-preview/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/catalogs/:id/preview',
    redirect: (to) => `/preview/${to.params.id as string}`,
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/settings/index.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/settings/project',
    name: 'project-settings',
    component: () => import('@/views/settings/ProjectSettings.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/profile/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/todos',
    name: 'todo-list',
    component: () => import('@/views/todo-list/index.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/feishu-callback',
    name: 'feishu-callback',
    component: () => import('@/views/feishu-callback/index.vue'),
  },
]
