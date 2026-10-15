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

# --- Merge requests for S-01 (F-02.1, F-02.2): Waiting for me, Mine and All open for `dev` ---
# Synthetic MAUI-like files; each MR is found again by its source branch, so re-runs skip it.

project = Project.find_by_full_path(full_path)
main = project.default_branch

def cs_file(name, lines)
  body = (1..lines).map { |i| "    // #{name} line #{i}" }.join("\n")
  "namespace Delivery.App;\n\npublic class #{name}\n{\n#{body}\n}\n"
end

def commit_files(project, user, branch, start, message, actions)
  result = Files::MultiService.new(
    project, user,
    commit_message: message, branch_name: branch, start_branch: start, actions: actions
  ).execute
  raise "commit #{branch}: #{result[:message]}" unless result[:status] == :success
end

BASE_FILES = {
  'src/Delivery.App/Services/UploadWorker.cs' => 40,
  'src/Delivery.App/Views/SignaturePage.xaml.cs' => 30,
  'src/Delivery.App/Resources/Styles/Buttons.xaml' => 20,
  'src/Delivery.App/Delivery.App.csproj' => 10
}.freeze

unless project.repository.blob_at(main, BASE_FILES.keys.first)
  actions = BASE_FILES.map do |path, lines|
    { action: 'create', file_path: path, content: cs_file(File.basename(path, '.*').delete('.'), lines) }
  end
  commit_files(project, root, main, main, 'Add the delivery app skeleton', actions)
  puts 'committed the app skeleton'
end

# A package bump counts as mechanical (F-05.5) only when the old package line is on main, so the
# test project comes in its own commit; on a stand-in seeded before it, MR !6 is rebased onto it.
TEST_PROJECT = 'tests/Delivery.App.Tests/Delivery.App.Tests.csproj'

def test_project(xunit)
  <<~XML
    <Project Sdk="Microsoft.NET.Sdk">

      <PropertyGroup>
        <TargetFramework>net9.0</TargetFramework>
      </PropertyGroup>

      <ItemGroup>
        <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
        <PackageReference Include="xunit" Version="#{xunit}" />
        <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
      </ItemGroup>

    </Project>
  XML
end

unless project.repository.blob_at(main, TEST_PROJECT)
  commit_files(project, root, main, main, 'Add the test project',
               [{ action: 'create', file_path: TEST_PROJECT, content: test_project('2.9.0') }])
  puts 'committed the test project'
end

def edit(path, lines, extra)
  { action: 'update', file_path: path,
    content: cs_file(File.basename(path, '.*').delete('.'), lines) + extra }
end

def create(path, lines)
  { action: 'create', file_path: path, content: cs_file(File.basename(path, '.*').delete('.'), lines) }
end

# author, title, branch, reviewers, file actions, pipeline status, extras
MRS = [
  { author: 'alice', title: 'Offline queue for delivery photos', branch: 'feature/offline-queue',
    reviewers: %w[dev], pipeline: 'success',
    actions: [create('src/Delivery.App/Services/PhotoQueue.cs', 60),
              create('src/Delivery.App/Services/PhotoQueueStore.cs', 45),
              edit('src/Delivery.App/Services/UploadWorker.cs', 36, "// queue hook\n")] },
  { author: 'bob', title: 'Crash when rotating the signature screen', branch: 'fix/signature-rotation',
    reviewers: %w[dev], pipeline: 'success',
    actions: [edit('src/Delivery.App/Views/SignaturePage.xaml.cs', 28, "// keep strokes on rotation\n")] },
  { author: 'alice', title: 'Migrate to .NET 10', branch: 'chore/net10',
    reviewers: %w[dev], pipeline: 'failed',
    actions: [edit('src/Delivery.App/Delivery.App.csproj', 8, "<!-- net10.0 -->\n")] +
             (1..44).map { |i| create("src/Delivery.App/Migrated/Page#{i}.cs", 12) } },
  { author: 'bob', title: 'Dark theme: button colors', branch: 'feature/dark-buttons',
    reviewers: %w[dev], approved_by: %w[dev], pipeline: 'running',
    actions: [edit('src/Delivery.App/Resources/Styles/Buttons.xaml', 18, "<!-- dark -->\n")] },
  { author: 'dev', title: 'Retry in UploadWorker after network loss', branch: 'fix/upload-retry',
    reviewers: %w[alice bob], pipeline: 'success',
    threads: [['alice', 'Should the retry back off?', false],
              ['bob', 'What happens when the token expires mid-upload?', false],
              ['alice', 'Typo in the log message.', true]],
    bump: [TEST_PROJECT, test_project('2.9.2'), 'Bump xunit to 2.9.2'],
    diff_thread: ['bob', 'src/Delivery.App/Services/UploadWorker.cs',
                  'Log the attempt number here, so support can count the retries.'],
    actions: [edit('src/Delivery.App/Services/UploadWorker.cs', 44, "// retry after network loss\n"),
              create('src/Delivery.App/Services/RetryPolicy.cs', 25)] },
  { author: 'alice', title: 'Draft: Localize the settings screen', branch: 'feature/settings-pl',
    reviewers: [], pipeline: nil,
    actions: [create('src/Delivery.App/Resources/Strings/Settings.pl.resx', 15)] }
].freeze

def add_pipeline(project, mr, status, user)
  pipeline = Ci::Pipeline.create!(
    project: project, ref: mr.source_branch, sha: mr.diff_head_sha, source: :merge_request_event,
    merge_request: mr, user: user, status: status
  )
  mr.update_column(:head_pipeline_id, pipeline.id)
end

def create_mr(project, author, main, spec, users)
  unless project.repository.branch_exists?(spec[:branch])
    commit_files(project, author, spec[:branch], main, spec[:title], spec[:actions])
  end
  mr = MergeRequests::CreateService.new(
    project: project, current_user: author,
    params: { source_branch: spec[:branch], target_branch: main, title: spec[:title],
              reviewer_ids: spec[:reviewers].map { |name| users.fetch(name).id } }
  ).execute
  raise "MR #{spec[:branch]}: #{mr.errors.full_messages.join(', ')}" unless mr.persisted?

  puts "created !#{mr.iid} #{spec[:title]}"
  mr.reload
end

# GitLab refreshes the MR diff after a push in Sidekiq; wait for it, then reload it ourselves.
def refreshed(project, mr, user)
  head = project.repository.commit(mr.source_branch).id
  60.times do
    return mr if mr.reload.diff_head_sha == head

    sleep 2
  end
  mr.reload_diff(user)
  mr.reload
end

def add_bump(project, mr, user, bump)
  path, content, message = bump
  current = project.repository.blob_at(mr.source_branch, path)&.data
  return mr if current == content

  unless current
    result = MergeRequests::RebaseService.new(project: project, current_user: user).execute(mr)
    raise "rebase !#{mr.iid}: #{result[:message]}" unless result[:status] == :success

    puts "rebased !#{mr.iid} onto #{mr.target_branch}"
  end
  commit_files(project, user, mr.source_branch, mr.source_branch, message,
               [{ action: 'update', file_path: path, content: content }])
  puts "committed #{message} to !#{mr.iid}"
  refreshed(project, mr, user)
end

# A thread on the last added line of the file (a DiffNote), left unresolved.
def add_diff_thread(mr, users, thread)
  name, path, text = thread
  return if mr.notes.where(type: 'DiffNote').exists?

  diff_file = mr.diffs.diff_files.find { |f| f.new_path == path }
  line = diff_file&.diff_lines&.reverse&.find(&:added?)
  raise "no added line in #{path} of !#{mr.iid}" unless line

  position = Gitlab::Diff::Position.new(
    old_path: path, new_path: path, old_line: nil, new_line: line.new_pos,
    position_type: 'text', diff_refs: mr.diff_refs
  )
  note = Notes::CreateService.new(
    mr.project, users.fetch(name),
    noteable_type: 'MergeRequest', noteable_id: mr.id, note: text, type: 'DiffNote',
    position: position.to_h
  ).execute
  raise "diff thread !#{mr.iid}: #{note.errors.full_messages.join(', ')}" unless note.persisted?

  puts "added a diff thread on #{path}:#{line.new_pos} of !#{mr.iid}"
end

# Each extra is checked on its own, so a run that stopped half-way is completed by the next one.
MRS.each do |spec|
  author = users.fetch(spec[:author])
  mr = project.merge_requests.find_by(source_branch: spec[:branch]) ||
       create_mr(project, author, main, spec, users)
  mr = add_bump(project, mr, author, spec[:bump]) if spec[:bump]
  stale = mr.head_pipeline&.sha != mr.diff_head_sha
  add_pipeline(project, mr, spec[:pipeline], author) if spec[:pipeline] && stale
  add_diff_thread(mr, users, spec[:diff_thread]) if spec[:diff_thread]
  Array(spec[:approved_by]).each do |name|
    approver = users.fetch(name)
    next if mr.approved_by?(approver)

    MergeRequests::ApprovalService.new(project: project, current_user: approver).execute(mr)
  end
  next if spec[:threads].nil? || mr.notes.where(type: 'DiscussionNote').exists?

  spec[:threads].each do |name, text, resolved|
    note = Notes::CreateService.new(
      project, users.fetch(name),
      noteable_type: 'MergeRequest', noteable_id: mr.id, note: text, type: 'DiscussionNote'
    ).execute
    note.discussion.resolve!(author) if resolved
  end
end

puts "seed done: users #{USERS.keys.join(', ')}, project #{full_path}, #{MRS.size} merge requests"
