import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { App } from 'src/entities/app.entity';
import { FolderApp } from 'src/entities/folder_app.entity';
import { UserGroupPermission } from 'src/entities/user_group_permission.entity';
import { Brackets, createQueryBuilder, Repository } from 'typeorm';
import { User } from '../../src/entities/user.entity';
import { Folder } from '../entities/folder.entity';
import { UsersService } from './users.service';

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(Folder)
    private foldersRepository: Repository<Folder>,
    @InjectRepository(FolderApp)
    private folderAppsRepository: Repository<FolderApp>,
    @InjectRepository(App)
    private appsRepository: Repository<App>,
    private usersService: UsersService
  ) {}

  async create(user: User, folderName): Promise<Folder> {
    return this.foldersRepository.save(
      this.foldersRepository.create({
        name: folderName,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId: user.organizationId,
      })
    );
  }

  async allFolders(user: User): Promise<Folder[]> {
    if (await this.usersService.hasGroup(user, 'admin')) {
      return await this.foldersRepository.find({
        where: {
          organizationId: user.organizationId,
        },
        relations: ['folderApps'],
        order: {
          name: 'ASC',
        },
      });
    }

    const allViewableApps = await createQueryBuilder(App, 'apps')
      .select('apps.id')
      .innerJoin('apps.groupPermissions', 'group_permissions')
      .innerJoin('apps.appGroupPermissions', 'app_group_permissions')
      .innerJoin(
        UserGroupPermission,
        'user_group_permissions',
        'app_group_permissions.group_permission_id = user_group_permissions.group_permission_id'
      )
      .where('user_group_permissions.user_id = :userId', { userId: user.id })
      .andWhere('app_group_permissions.read = :value', { value: true })
      .orWhere('(apps.is_public = :value AND apps.organization_id = :organizationId) OR apps.user_id = :userId', {
        value: true,
        organizationId: user.organizationId,
        userId: user.id,
      })
      .getMany();
    const allViewableAppIds = allViewableApps.map((app) => app.id);

    if (allViewableAppIds.length !== 0) {
      return await createQueryBuilder(Folder, 'folders')
        .leftJoinAndSelect('folders.folderApps', 'folder_apps')
        .where('folder_apps.app_id IN(:...allViewableAppIds)', {
          allViewableAppIds,
        })
        .andWhere('folders.organization_id = :organizationId', {
          organizationId: user.organizationId,
        })
        .orWhere('folder_apps.app_id IS NULL')
        .orderBy('folders.name', 'ASC')
        .distinct()
        .getMany();
    } else {
      return [];
    }
  }
  async all(user: User, searchKey: string): Promise<Folder[]> {
    const allFloderList = await this.allFolders(user);
    if (!searchKey || !allFloderList || allFloderList.length === 0) {
      return allFloderList;
    }
    const folders = await this.allFoldersWithSearchKey(user, searchKey);
    allFloderList.forEach((folder, index) => {
      const currentFolder = folders.filter((f) => f.id === folder.id);
      if (currentFolder && currentFolder.length > 0) {
        allFloderList[index] = currentFolder[0];
      } else {
        allFloderList[index].folderApps = [];
        allFloderList[index].generateCount();
      }
    });
    return allFloderList;
  }
  async allFoldersWithSearchKey(user: User, searchKey: string): Promise<Folder[]> {
    const allViewableAppsWithSearchQb = createQueryBuilder(App, 'apps')
      .select('apps.id')
      .innerJoin('apps.groupPermissions', 'group_permissions')
      .innerJoin('apps.appGroupPermissions', 'app_group_permissions')
      .innerJoin(
        UserGroupPermission,
        'user_group_permissions',
        'app_group_permissions.group_permission_id = user_group_permissions.group_permission_id'
      )
      .where(
        new Brackets((qb) => {
          qb.where('user_group_permissions.user_id = :userId', { userId: user.id })
            .andWhere('app_group_permissions.read = :value', { value: true })
            .orWhere('(apps.is_public = :value AND apps.organization_id = :organizationId) OR apps.user_id = :userId', {
              value: true,
              organizationId: user.organizationId,
              userId: user.id,
            });
        })
      );
    allViewableAppsWithSearchQb.andWhere('LOWER(apps.name) like :searchKey', {
      searchKey: `%${searchKey && searchKey.toLowerCase()}%`,
    });

    const allViewableAppsWithSearch = await allViewableAppsWithSearchQb.getMany();

    const allViewableAppIdsWithSearch = allViewableAppsWithSearch.map((app) => app.id);

    if (allViewableAppIdsWithSearch.length !== 0) {
      return await createQueryBuilder(Folder, 'folders')
        .leftJoinAndSelect('folders.folderApps', 'folder_apps')
        .where('folder_apps.app_id IN(:...allViewableAppIdsWithSearch)', {
          allViewableAppIdsWithSearch,
        })
        .andWhere('folders.organization_id = :organizationId', {
          organizationId: user.organizationId,
        })
        .orWhere('folder_apps.app_id IS NULL')
        .orderBy('folders.name', 'ASC')
        .distinct()
        .getMany();
    }
    return [];
  }

  async findOne(folderId: string): Promise<Folder> {
    return await this.foldersRepository.findOneOrFail(folderId);
  }

  async userAppCount(user: User, folder: Folder, searchKey: string) {
    const folderApps = await this.folderAppsRepository.find({
      where: {
        folderId: folder.id,
      },
    });
    const folderAppIds = folderApps.map((folderApp) => folderApp.appId);

    if (folderAppIds.length == 0) {
      return 0;
    }

    const viewableAppsQb = createQueryBuilder(App, 'viewable_apps')
      .innerJoin('viewable_apps.groupPermissions', 'group_permissions')
      .innerJoinAndSelect('viewable_apps.appGroupPermissions', 'app_group_permissions')
      .innerJoinAndSelect('viewable_apps.user', 'user')
      .innerJoin(
        UserGroupPermission,
        'user_group_permissions',
        'app_group_permissions.group_permission_id = user_group_permissions.group_permission_id'
      )
      .where(
        new Brackets((qb) => {
          qb.where('user_group_permissions.user_id = :userId', { userId: user.id })
            .andWhere('app_group_permissions.read = :value', { value: true })
            .orWhere(
              '(viewable_apps.is_public = :value AND viewable_apps.organization_id = :organizationId) ' +
                'OR viewable_apps.user_id = :userId',
              {
                value: true,
                organizationId: user.organizationId,
                userId: user.id,
              }
            );
        })
      );
    if (searchKey) {
      viewableAppsQb.andWhere('LOWER(viewable_apps.name) like :searchKey', {
        searchKey: `%${searchKey && searchKey.toLowerCase()}%`,
      });
    }

    const folderAppsQb = createQueryBuilder(App, 'apps_in_folder').whereInIds(folderAppIds);

    return await createQueryBuilder(App, 'apps')
      .innerJoin(
        '(' + viewableAppsQb.getQuery() + ')',
        'viewable_apps_join',
        'apps.id = viewable_apps_join.viewable_apps_id'
      )
      .innerJoin(
        '(' + folderAppsQb.getQuery() + ')',
        'apps_in_folder_join',
        'apps.id = apps_in_folder_join.apps_in_folder_id'
      )
      .setParameters({
        ...folderAppsQb.getParameters(),
        ...viewableAppsQb.getParameters(),
      })
      .getCount();
  }

  async getAppsFor(user: User, folder: Folder, page: number, searchKey: string): Promise<App[]> {
    const folderApps = await this.folderAppsRepository.find({
      where: {
        folderId: folder.id,
      },
    });
    const folderAppIds = folderApps.map((folderApp) => folderApp.appId);

    if (folderAppIds.length == 0) {
      return [];
    }

    const viewableAppsQb = createQueryBuilder(App, 'viewable_apps')
      .innerJoin('viewable_apps.groupPermissions', 'group_permissions')
      .innerJoinAndSelect('viewable_apps.appGroupPermissions', 'app_group_permissions')
      .innerJoinAndSelect('viewable_apps.user', 'user')
      .innerJoin(
        UserGroupPermission,
        'user_group_permissions',
        'app_group_permissions.group_permission_id = user_group_permissions.group_permission_id'
      )
      .where(
        new Brackets((qb) => {
          qb.where('user_group_permissions.user_id = :userId', { userId: user.id })
            .andWhere('app_group_permissions.read = :value', { value: true })
            .orWhere(
              '(viewable_apps.is_public = :value AND viewable_apps.organization_id = :organizationId) ' +
                'OR viewable_apps.user_id = :userId',
              {
                value: true,
                organizationId: user.organizationId,
                userId: user.id,
              }
            );
        })
      );
    if (searchKey) {
      viewableAppsQb.andWhere('LOWER(viewable_apps.name) like :searchKey', {
        searchKey: `%${searchKey && searchKey.toLowerCase()}%`,
      });
    }

    const folderAppsQb = createQueryBuilder(App, 'apps_in_folder').whereInIds(folderAppIds);

    const viewableAppsInFolder = await createQueryBuilder(App, 'apps')
      .innerJoin(
        '(' + viewableAppsQb.getQuery() + ')',
        'viewable_apps_join',
        'apps.id = viewable_apps_join.viewable_apps_id'
      )
      .innerJoin(
        '(' + folderAppsQb.getQuery() + ')',
        'apps_in_folder_join',
        'apps.id = apps_in_folder_join.apps_in_folder_id'
      )
      .innerJoinAndSelect('apps.user', 'user')
      .setParameters({
        ...folderAppsQb.getParameters(),
        ...viewableAppsQb.getParameters(),
      })
      .take(10)
      .skip(10 * (page - 1))
      .orderBy('apps.createdAt', 'DESC')
      .getMany();

    return viewableAppsInFolder;
  }
}
