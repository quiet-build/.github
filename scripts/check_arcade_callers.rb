# Native contract regression: check the actual reusable YAML and caller YAML.
# Usage: ruby scripts/check_arcade_callers.rb WORKFLOW SUPPORT_SHA CALLER...
require 'yaml'

def check(condition, message)
  raise message unless condition
end

workflow_path, sha, *callers = ARGV
check(sha && sha.match?(/\A[a-f0-9]{40}\z/) && !callers.empty?, 'Provide workflow, full support SHA, and callers')
workflow = YAML.safe_load(File.read(workflow_path))
inputs = (workflow['on'] || workflow[true]).fetch('workflow_call').fetch('inputs')
rank = { 'none' => 0, 'read' => 1, 'write' => 2 }
pages_count = 0

callers.each do |path|
  caller = YAML.safe_load(File.read(path)).fetch('jobs').fetch('deploy')
  supplied = caller.fetch('with')
  check((supplied.keys - inputs.keys).empty?, "#{path}: unknown inputs")
  inputs.each do |name, definition|
    check(!definition['required'] || supplied.key?(name), "#{path}: missing #{name}")
    check(!supplied.key?(name) || definition['type'] != 'string' || supplied[name].is_a?(String), "#{path}: #{name} must be string")
  end
  check(caller['uses'] == "quiet-build/.github/.github/workflows/deploy-arcade-component.yml@#{sha}" && supplied['support-sha'] == sha, "#{path}: workflow/helper pins differ")
  pages = !supplied.fetch('pages-base', '').empty?
  grant = caller.fetch('permissions')
  expected = { 'contents' => 'write' }
  expected.merge!('pages' => 'write', 'id-token' => 'write') if pages
  check(grant == expected, "#{path}: caller must grant only the permissions its publications require")
  inherited = workflow.fetch('permissions', grant)
  workflow.fetch('jobs').each do |name, job|
    effective = job.fetch('permissions', inherited)
    # Validation applies even when the job's runtime condition will skip it.
    effective.each do |scope, access|
      check(rank.fetch(access) <= rank.fetch(grant.fetch(scope, 'none')), "#{path}: #{name} requests #{scope}: #{access}, caller grants #{grant.fetch(scope, 'none')}")
    end
    check(effective == { 'contents' => 'write' }, "#{path}: Cloudflare must remain contents-only") if name == 'cloudflare'
    next unless name == 'github-pages'
    check(job['if'] == "inputs.pages-base != ''", "#{path}: optional Pages publication condition changed")
    check(!pages || (effective['pages'] == 'write' && effective['id-token'] == 'write'), "#{path}: enabled Pages publication lacks Pages/OIDC access")
  end
  pages_count += 1 if pages
end

puts "#{callers.length} callers valid: #{callers.length - pages_count} contents-only, #{pages_count} Pages/OIDC; all child permissions and input/pin contracts valid"
