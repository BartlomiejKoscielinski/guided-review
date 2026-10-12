# Stand-in GitLab seed (tools/standin/README.md): synthetic users, group and sandbox project.
# Idempotent; prints names only. Run inside the container:
#   docker cp tools/standin/seed.rb gr-standin-gitlab:/tmp/seed.rb
#   docker exec gr-standin-gitlab gitlab-rails runner /tmp/seed.rb
#
# Users get random passwords nobody knows; root sets one in the Admin area when someone has to
# sign in as that user (README step 7).

USERS = {
  'dev' => 'Dev Stand-in', # the developer using Guided Review
  'alice' => 'Alice Stand-in', # teammates: MR authors and reviewers in scenarios
  'bob' => 'Bob Stand-in'
}.freeze
GROUP_PATH = 'sandbox'
PROJECT_PATH = 'gr-sandbox'

root = User.find_by!(username: 'root')
organization = Organizations::Organization.default_organization

# Services return the record in some versions and a ServiceResponse in others.
def record(result, key)
  result.is_a?(ServiceResponse) ? result[key] : result
end

users = USERS.to_h do |username, name|
  user = User.find_by(username: username)
  unless user
    result = Users::CreateService.new(
      root,
      username: username,
      name: name,
      email: "#{username}@standin.test",
      force_random_password: true,
      reset_password: false,
      skip_confirmation: true,
      organization_id: organization.id
    ).execute
    user = record(result, :user)
    raise "user #{username}: #{user&.errors&.full_messages&.join(', ')}" unless user&.persisted?

    puts "created user #{username}"
  end
  [username, user]
end

group = Group.find_by_full_path(GROUP_PATH)
unless group
  result = Groups::CreateService.new(
    root,
    name: 'Sandbox',
    path: GROUP_PATH,
    visibility_level: Gitlab::VisibilityLevel::PRIVATE,
    organization_id: organization.id
  ).execute
  group = record(result, :group)
  raise "group: #{group&.errors&.full_messages&.join(', ')}" unless group&.persisted?

  puts "created group #{GROUP_PATH}"
end

users.each_value do |user|
  next if group.member?(user)

  group.add_member(user, Gitlab::Access::DEVELOPER)
  puts "#{user.username} is a developer in #{GROUP_PATH}"
end

full_path = "#{GROUP_PATH}/#{PROJECT_PATH}"
unless Project.find_by_full_path(full_path)
  project = Projects::CreateService.new(
    root,
    name: PROJECT_PATH,
    path: PROJECT_PATH,
    namespace_id: group.id,
    visibility_level: Gitlab::VisibilityLevel::PRIVATE,
    initialize_with_readme: true
  ).execute
  raise "project: #{project.errors.full_messages.join(', ')}" unless project.persisted?

  puts "created project #{full_path}"
end

puts "seed done: users #{USERS.keys.join(', ')}, project #{full_path}"
