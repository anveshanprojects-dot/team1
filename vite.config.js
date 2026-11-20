import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repository = process.env.GITHUB_REPOSITORY
const repositoryName = repository?.split('/')[1]
const isUserOrOrganizationSite = repositoryName?.endsWith('.github.io')
const base = process.env.GITHUB_ACTIONS === 'true' && repositoryName && !isUserOrOrganizationSite
  ? `/${repositoryName}/`
  : '/'

export default defineConfig({
  base,
  plugins: [react()],
})
