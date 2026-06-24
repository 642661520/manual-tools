import { ref, computed } from 'vue'

interface Project {
  id: string
  name: string
  description: string
}

const projects = ref<Project[]>([])
const currentProjectId = ref<string | null>(localStorage.getItem('active_project_id'))
const loaded = ref(false)

export function useProject() {
  const currentProject = computed(() =>
    projects.value.find(p => p.id === currentProjectId.value) || null
  )

  async function loadProjects() {
    const token = localStorage.getItem('auth_token')
    if (!token) return
    try {
      const res = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const list: Project[] = await res.json()
        projects.value = list

        // 如果当前选中的项目不在列表中，回退到第一个
        if (currentProjectId.value && !list.find(p => p.id === currentProjectId.value)) {
          currentProjectId.value = list[0]?.id || null
          persist()
        }
        // 尚未选择项目则默认选中第一个
        if (!currentProjectId.value && list.length > 0) {
          currentProjectId.value = list[0].id
          persist()
        }
        loaded.value = true
      }
    } catch { /* ignore */ }
  }

  function switchProject(id: string) {
    currentProjectId.value = id
    persist()
  }

  function persist() {
    if (currentProjectId.value) {
      localStorage.setItem('active_project_id', currentProjectId.value)
    } else {
      localStorage.removeItem('active_project_id')
    }
  }

  return {
    projects,
    currentProject,
    currentProjectId,
    loaded,
    loadProjects,
    switchProject,
  }
}
