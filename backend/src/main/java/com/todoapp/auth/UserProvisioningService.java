package com.todoapp.auth;

import com.todoapp.common.Ids;
import com.todoapp.common.SortRanks;
import com.todoapp.list.TodoList;
import com.todoapp.mapper.IdentityMapper;
import com.todoapp.mapper.ListMapper;
import com.todoapp.me.UserSettings;
import java.time.LocalTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserProvisioningService {
  private final IdentityMapper identityMapper;
  private final ListMapper listMapper;

  public UserProvisioningService(IdentityMapper identityMapper, ListMapper listMapper) {
    this.identityMapper = identityMapper;
    this.listMapper = listMapper;
  }

  @Transactional
  public User createUser(String email, String displayName, String provider, String providerUserId) {
    User user = new User();
    user.setId(Ids.uuidv7());
    user.setEmail(email.toLowerCase());
    user.setDisplayName(displayName);
    user.setTimezone("UTC");
    user.setLocale("zh-CN");
    user.setAuthVersion(1L);
    identityMapper.insertUser(user);

    TodoList inbox = new TodoList();
    inbox.setId(Ids.uuidv7());
    inbox.setUserId(user.getId());
    inbox.setName("收件箱");
    inbox.setColor("coral");
    inbox.setIcon("inbox");
    inbox.setSortRank(SortRanks.newListSortRank());
    inbox.setIsArchived(false);
    inbox.setIsDefault(true);
    inbox.setVersion(1L);
    listMapper.insertList(inbox);

    UserSettings settings = new UserSettings();
    settings.setUserId(user.getId());
    settings.setTheme("system");
    settings.setAccent("coral");
    settings.setWeekStart("monday");
    settings.setDefaultListId(inbox.getId());
    settings.setDefaultReminderTime(LocalTime.of(9, 0));
    settings.setTimeFormat("24h");
    settings.setNotificationPrefs("{}");
    settings.setVersion(1L);
    identityMapper.insertSettings(settings);

    AuthIdentity identity = new AuthIdentity();
    identity.setId(Ids.uuidv7());
    identity.setUserId(user.getId());
    identity.setProvider(provider);
    identity.setProviderUserId(providerUserId);
    identityMapper.insertIdentity(identity);

    return identityMapper.selectUserById(user.getId());
  }
}
